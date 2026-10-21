#!/usr/bin/env python3
"""Copy ENT events from the MongoDB "events" collection into the PostgreSQL event store.

Rows are built the same way as org.entcore.common.events.impl.PostgresqlEventStore#store:
known event types go to events.<type>_events, the others to events.unknown_events
(or are skipped when --allowed-events is set). MongoDB is only read.

Requirements: pip install pymongo==4.17.0 psycopg2-binary (pymongo 4.18+ requires MongoDB 4.4)
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras
from pymongo import MongoClient

KNOWN_EVENT_DROPPED_FIELDS = ("structures", "classes", "groups", "referer", "sessionId")
# Tables also written by a trigger when inserting in a table (room_events_to_connector.sql)
TRIGGER_TARGETS = {"room_access_events": ["connector_events"], "room_creation_events": ["connector_events"]}


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--mongo-uri", required=True)
    p.add_argument("--mongo-db", required=True)
    p.add_argument("--mongo-collection", default="events")
    p.add_argument("--pg-dsn", help="ex: postgresql://user:pwd@host:5432/db (optional with --dry-run)")
    p.add_argument("--platform-id", required=True, help="value of event-store.platform in ent-core conf")
    p.add_argument("--timezone", default="Europe/Paris", help="JVM timezone of ent-core (dates are stored as local timestamps)")
    p.add_argument("--from-date", help="only events with date >= this local ISO date (--timezone)")
    p.add_argument("--to-date", help="only events with date < this local ISO date (--timezone)")
    p.add_argument("--allowed-events", default="", help="same as event-store.postgresql.allowed-events, comma separated")
    p.add_argument("--known-events", default="", help="with --dry-run and no PG: event types having a table, comma separated")
    p.add_argument("--create-partitions", action="store_true", help="create missing monthly partitions")
    p.add_argument("--batch-size", type=int, default=1000)
    p.add_argument("--dry-run", action="store_true", help="read and transform only, nothing is written")
    return p.parse_args()


def to_millis(iso, tz):
    d = datetime.fromisoformat(iso)
    if d.tzinfo is None:
        d = d.replace(tzinfo=tz)
    return int(d.timestamp() * 1000)


def snake(name):
    return re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", name).replace("-", "_").lower()


PARTITION_BOUND = re.compile(r"FROM \('([^']+)'\) TO \('([^']+)'\)")


class Schema:
    def __init__(self, conn, allowed_events, known_events_arg):
        self.conn = conn
        self.columns = {}
        self.max_lengths = {}
        self.partitioned = set()
        self.partition_names = set()
        self.partition_ranges = defaultdict(list)
        if conn is None:
            types = {t.strip().upper() for t in known_events_arg.split(",") if t.strip()}
        else:
            with conn.cursor() as cur:
                cur.execute("SELECT table_name, column_name, data_type, character_maximum_length "
                            "FROM information_schema.columns "
                            "WHERE table_schema = 'events' AND table_name LIKE '%%\\_events'")
                for table, column, data_type, max_length in cur.fetchall():
                    self.columns.setdefault(table, {})[column] = data_type
                    if max_length:
                        self.max_lengths[(table, column)] = max_length
                cur.execute("SELECT c.relname FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid "
                            "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'events'")
                self.partitioned = {r[0] for r in cur.fetchall()}
                cur.execute("SELECT parent.relname, child.relname, pg_get_expr(child.relpartbound, child.oid) "
                            "FROM pg_inherits i JOIN pg_class parent ON parent.oid = i.inhparent "
                            "JOIN pg_class child ON child.oid = i.inhrelid "
                            "JOIN pg_namespace n ON n.oid = parent.relnamespace WHERE n.nspname = 'events'")
                for parent, child, bound in cur.fetchall():
                    self.partition_names.add(child)
                    m = PARTITION_BOUND.search(bound or "")
                    if m:
                        self.partition_ranges[parent].append((datetime.fromisoformat(m.group(1)),
                                                              datetime.fromisoformat(m.group(2))))
            types = {t[:-len("_events")].upper() for t in self.columns}
        allowed = {t.strip() for t in allowed_events.split(",") if t.strip()}
        self.known_events = {t for t in types if t in allowed} if allowed else types
        self.allowed = allowed

    def column_for(self, table, key):
        cols = self.columns.get(table)
        if cols is None:
            return key
        for candidate in (key, key.replace("-", "_"), snake(key)):
            if candidate in cols:
                return candidate
        return None


def transform(doc, schema, tz):
    event = dict(doc)
    event_id = event.pop("_id", None)
    ua = event.pop("ua", None)
    event_type = event.pop("event-type", None)
    user_id = event.pop("userId", None)
    profile = event.pop("profil", None)
    resource_type = event.pop("resource-type", None)
    date = datetime.fromtimestamp(event.pop("date") / 1000, tz).replace(tzinfo=None)
    if event_type in schema.known_events:
        for f in KNOWN_EVENT_DROPPED_FIELDS:
            event.pop(f, None)
        row = event
        table = event_type.lower() + "_events"
    elif not schema.allowed:
        row = {}
        module = event.pop("module", None)
        if module is not None:
            row["module"] = module
        row["payload"] = json.dumps(event, default=str)
        table = "unknown_events"
    else:
        return None, None
    row["id"] = str(event_id) if event_id is not None else None
    row["event_type"] = event_type
    row["date"] = date
    if ua:
        row["ua"] = ua
    if user_id:
        row["user_id"] = user_id
    if profile:
        row["profile"] = profile
    if resource_type:
        row["resource_type"] = resource_type
    ip = row.get("ip")
    if isinstance(ip, str) and "," in ip:
        row["ip"] = ip[:ip.index(",")]
    return table, row


def to_columns(table, row, schema, unmapped, truncated, platform_id):
    out = {"platform_id": platform_id}
    for key, value in row.items():
        if value is None:
            continue
        column = schema.column_for(table, key)
        if column is None:
            unmapped[table][key] += 1
            continue
        data_type = schema.columns.get(table, {}).get(column)
        if isinstance(value, (list, dict)):
            if data_type == "ARRAY" and isinstance(value, list):
                value = [str(v) for v in value]
            elif data_type in ("json", "jsonb"):
                value = psycopg2.extras.Json(value)
            else:
                value = json.dumps(value, default=str)
        max_length = schema.max_lengths.get((table, column))
        if max_length and isinstance(value, str) and len(value) > max_length:
            value = value[:max_length]
            truncated[(table, column)] += 1
        out[column] = value
    return out


def month_start(d):
    return d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def next_month(m):
    return datetime(m.year + (m.month == 12), m.month % 12 + 1, 1)


def ensure_partitions(conn, schema, table, dates, create):
    for target in TRIGGER_TARGETS.get(table, []):
        ensure_partitions(conn, schema, target, dates, create)
    if table not in schema.partitioned:
        return
    ranges = schema.partition_ranges[table]
    uncovered = {month_start(d) for d in dates if not any(lo <= d < hi for lo, hi in ranges)}
    if not uncovered:
        return
    missing = sorted(uncovered)
    if not create:
        sys.exit(f"Missing partitions on events.{table}: {', '.join(f'{m:%Y%m}' for m in missing)} "
                 f"(use --create-partitions)")
    with conn.cursor() as cur:
        for m in missing:
            nxt = next_month(m)
            if any(lo < nxt and m < hi for lo, hi in ranges):
                sys.exit(f"events.{table}: {m:%Y-%m} is partly covered by existing partitions, "
                         f"create the missing ones manually")
            name = f"{table}{m:%Y%m}"
            if name in schema.partition_names:
                name += "_m"
            cur.execute(f'CREATE TABLE events."{name}" PARTITION OF events."{table}" '
                        f"FOR VALUES FROM ('{m:%Y-%m-%d} 00:00:00') TO ('{nxt:%Y-%m-%d} 00:00:00')")
            cur.execute(f'CREATE INDEX ON events."{name}" USING brin (date)')
            ranges.append((m, nxt))
            schema.partition_names.add(name)
            print(f"  partition created: events.{name}")
    conn.commit()


def insert_batch(conn, table, rows):
    ids = [r["id"] for r in rows]
    with conn.cursor() as cur:
        cur.execute(f'SELECT id::text FROM events."{table}" WHERE id::text = ANY(%s)', (ids,))
        existing = {r[0] for r in cur.fetchall()}
        rows = [r for r in rows if r["id"] not in existing]
        by_columns = defaultdict(list)
        for r in rows:
            by_columns[tuple(sorted(r))].append(r)
        for columns, group in by_columns.items():
            cols = ", ".join(f'"{c}"' for c in columns)
            psycopg2.extras.execute_values(cur, f'INSERT INTO events."{table}" ({cols}) VALUES %s',
                                           [tuple(r[c] for c in columns) for r in group])
    conn.commit()
    return len(rows), len(existing)


def main():
    args = parse_args()
    if not args.dry_run and not args.pg_dsn:
        sys.exit("--pg-dsn is required unless --dry-run")
    tz = ZoneInfo(args.timezone)
    conn = psycopg2.connect(args.pg_dsn) if args.pg_dsn else None
    schema = Schema(conn, args.allowed_events, args.known_events)
    print(f"Known event types: {', '.join(sorted(schema.known_events)) or '(none)'}")

    query = {}
    if args.from_date or args.to_date:
        query["date"] = {}
        if args.from_date:
            query["date"]["$gte"] = to_millis(args.from_date, tz)
        if args.to_date:
            query["date"]["$lt"] = to_millis(args.to_date, tz)
    collection = MongoClient(args.mongo_uri)[args.mongo_db][args.mongo_collection]
    total = collection.count_documents(query)
    print(f"Mongo events to process: {total}")

    stats = Counter()
    per_table = Counter()
    unmapped = defaultdict(Counter)
    truncated = Counter()
    missing_partitions = defaultdict(set)
    buffers = defaultdict(list)

    def flush(table):
        rows = buffers.pop(table, [])
        if not rows:
            return
        if args.dry_run or conn is None:
            stats["would_insert"] += len(rows)
            if table in schema.partitioned:
                ranges = schema.partition_ranges[table]
                missing_partitions[table].update(month_start(r["date"]) for r in rows
                                                 if not any(lo <= r["date"] < hi for lo, hi in ranges))
            return
        ensure_partitions(conn, schema, table, {r["date"] for r in rows}, args.create_partitions)
        inserted, existing = insert_batch(conn, table, rows)
        stats["inserted"] += inserted
        stats["already_present"] += existing

    for n, doc in enumerate(collection.find(query), 1):
        if not isinstance(doc.get("date"), (int, float)):
            stats["skipped_bad_date"] += 1
            continue
        table, row = transform(doc, schema, tz)
        if table is None:
            stats["skipped_not_allowed"] += 1
            continue
        per_table[table] += 1
        buffers[table].append(to_columns(table, row, schema, unmapped, truncated, args.platform_id))
        if len(buffers[table]) >= args.batch_size:
            flush(table)
        if n % 10000 == 0:
            print(f"  {n}/{total}")
    for table in list(buffers):
        flush(table)

    print("\nEvents per target table:")
    for table, count in sorted(per_table.items()):
        print(f"  events.{table}: {count}")
    if unmapped:
        print("\nFields without matching column (not copied):")
        for table, fields in sorted(unmapped.items()):
            print(f"  events.{table}: " + ", ".join(f"{k} ({v})" for k, v in fields.most_common()))
    if truncated:
        print("\nValues truncated to the column length:")
        for (table, column), count in sorted(truncated.items()):
            print(f"  events.{table}.{column}: {count}")
    if missing_partitions:
        print("\nMissing partitions (created by --create-partitions):")
        for table, months in sorted(missing_partitions.items()):
            print(f"  events.{table}: {len(months)} months, {min(months):%Y%m} -> {max(months):%Y%m}")
    print("\nSummary: " + ", ".join(f"{k}={v}" for k, v in sorted(stats.items())))


if __name__ == "__main__":
    main()
