#!/usr/bin/env python3
"""Fill stats.access_* CONNECTOR rows from the MongoDB "events" collection, for the periods before the switch
of the event store to PostgreSQL.

Values are computed like com.opendigitaleducation.stats.aggregation.AccessAggregation (access, unique_access_minute,
unique_access, *_wta), but structures and classes come from the event itself (state at the time of the event)
instead of the current repository. ROOM_ACCESS / ROOM_CREATION events are written as the WebConferenceRoomAccess /
WebConferenceRoomCreation connectors. Only periods ending before --to-date are written. MongoDB is only read.

Requirements: pip install pymongo psycopg2-binary
"""
import argparse
import hashlib
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg2
import psycopg2.extras
from pymongo import MongoClient

ROOM_MODULES = {"ROOM_ACCESS": "WebConferenceRoomAccess", "ROOM_CREATION": "WebConferenceRoomCreation"}
EVENT_TYPES = ["CONNECTOR"] + list(ROOM_MODULES)
FREQUENCIES = ("hour", "day", "week", "month")
LEVELS = ("platform", "tenant", "structure", "class")
CONNECTOR_TYPE = "CONNECTOR"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--mongo-uri", required=True)
    p.add_argument("--mongo-db", required=True)
    p.add_argument("--mongo-collection", default="events")
    p.add_argument("--pg-dsn", help="ex: postgresql://user:pwd@host:5432/db (optional with --dry-run)")
    p.add_argument("--platform-id", required=True, help="value of event-store.platform in ent-core conf")
    p.add_argument("--timezone", default="Europe/Paris", help="JVM timezone of ent-core")
    p.add_argument("--from-date", help="first local date to process (ISO)")
    p.add_argument("--to-date", required=True, help="local date of the event store switch (ISO), excluded")
    p.add_argument("--levels", default=",".join(LEVELS))
    p.add_argument("--frequencies", default=",".join(FREQUENCIES))
    p.add_argument("--batch-size", type=int, default=1000)
    p.add_argument("--dry-run", action="store_true", help="compute only, nothing is written")
    return p.parse_args()


def period_start(d, frequency):
    if frequency == "hour":
        return d.replace(minute=0, second=0, microsecond=0)
    day = d.replace(hour=0, minute=0, second=0, microsecond=0)
    if frequency == "day":
        return day
    if frequency == "week":
        return day - timedelta(days=day.weekday())
    return day.replace(day=1)


def period_end(start, frequency):
    if frequency == "hour":
        return start + timedelta(hours=1)
    if frequency == "day":
        return start + timedelta(days=1)
    if frequency == "week":
        return start + timedelta(days=7)
    return datetime(start.year + (start.month == 12), start.month % 12 + 1, 1)


def row_id(table, platform_id, date, entity, profile, module):
    key = f"{table}|{platform_id}|{date:%Y-%m-%d %H:%M:%S}|{entity}|{profile}|{CONNECTOR_TYPE}|{module}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


class Repository:
    def __init__(self, conn, platform_id):
        self.available = conn is not None
        self.parents = {}
        self.tenant_of = {}
        self.classes = set()
        self.tenants = set()
        if conn is None:
            return
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM repository.platforms WHERE id = %s", (platform_id,))
            if cur.fetchone()[0] == 0:
                sys.exit(f"Platform {platform_id} not found in repository.platforms (run the repository sync first)")
            cur.execute("SELECT id, parent_structures, tenant_id FROM repository.structures")
            for sid, parents, tenant in cur.fetchall():
                self.parents[sid] = set(parents or [])
                if tenant:
                    self.tenant_of[sid] = tenant
            cur.execute("SELECT id FROM repository.classes")
            self.classes = {r[0] for r in cur.fetchall()}
            cur.execute("SELECT id FROM repository.tenants")
            self.tenants = {r[0] for r in cur.fetchall()}

    def direct_structures(self, structures):
        ancestors = set()
        for s in structures:
            ancestors |= self.parents.get(s, set())
        return [s for s in structures if s not in ancestors]


class Accumulator:
    def __init__(self):
        self.ids = set()
        self.minutes = set()
        self.users = set()

    def add(self, event_id, minute, user):
        self.ids.add(event_id)
        self.minutes.add((minute, user))
        self.users.add(user)

    def values(self):
        return len(self.ids), len(self.minutes), len(self.users)


def main():
    args = parse_args()
    if not args.dry_run and not args.pg_dsn:
        sys.exit("--pg-dsn is required unless --dry-run")
    tz = ZoneInfo(args.timezone)
    levels = [lv for lv in args.levels.split(",") if lv]
    frequencies = [f for f in args.frequencies.split(",") if f]
    to_date = datetime.fromisoformat(args.to_date).replace(tzinfo=None)
    from_date = datetime.fromisoformat(args.from_date).replace(tzinfo=None) if args.from_date else None

    conn = psycopg2.connect(args.pg_dsn) if args.pg_dsn else None
    repo = Repository(conn, args.platform_id)
    if not repo.available:
        print("No --pg-dsn: *_wta uses all structures and entities are not checked against the repository")

    query = {"event-type": {"$in": EVENT_TYPES},
             "date": {"$lt": int(to_date.replace(tzinfo=tz).timestamp() * 1000)}}
    if from_date:
        query["date"]["$gte"] = int(from_date.replace(tzinfo=tz).timestamp() * 1000)
    collection = MongoClient(args.mongo_uri)[args.mongo_db][args.mongo_collection]

    acc = defaultdict(Accumulator)
    acc_wta = defaultdict(Accumulator)
    stats = Counter()
    missing = defaultdict(set)
    per_module = Counter()

    for doc in collection.find(query):
        profile, user, date = doc.get("profil"), doc.get("userId"), doc.get("date")
        if not profile or not user or not isinstance(date, (int, float)):
            stats["skipped_no_profile_or_user"] += 1
            continue
        event_type = doc["event-type"]
        module = ROOM_MODULES.get(event_type) or doc.get("cas-type") or doc.get("module")
        if not module:
            stats["skipped_no_module"] += 1
            continue
        stats["events"] += 1
        per_module[module] += 1
        local = datetime.fromtimestamp(date / 1000, tz).replace(tzinfo=None)
        minute = local.replace(second=0, microsecond=0)
        event_id = str(doc["_id"])
        structures = [s for s in (doc.get("structures") or []) if s]
        classes = [c for c in (doc.get("classes") or []) if c]

        entities = {"platform": [""], "structure": structures, "class": classes,
                    "tenant": sorted({repo.tenant_of[s] for s in structures if s in repo.tenant_of})}
        direct = repo.direct_structures(structures) if repo.available else structures
        for frequency in frequencies:
            start = period_start(minute, frequency)
            if period_end(start, frequency) > to_date:
                continue
            for level in levels:
                for entity in entities[level]:
                    acc[(level, frequency, start, entity, profile, module)].add(event_id, minute, user)
            if "structure" in levels:
                for entity in direct:
                    acc_wta[("structure", frequency, start, entity, profile, module)].add(event_id, minute, user)

    rows = defaultdict(list)
    for key in set(acc) | set(acc_wta):
        level, frequency, start, entity, profile, module = key
        if repo.available and level != "platform":
            known = {"structure": repo.parents, "class": repo.classes, "tenant": repo.tenants}[level]
            if entity not in known:
                missing[level].add(entity)
                continue
        table = f"access_{level}_{frequency}s"
        row = {"id": row_id(table, args.platform_id, start, entity, profile, module),
               "platform_id": args.platform_id, "date": start, "profile": profile,
               "type": CONNECTOR_TYPE, "module": module}
        if level != "platform":
            row[f"{level}_id"] = entity
        row["access"], row["unique_access_minute"], row["unique_access"] = \
            acc[key].values() if key in acc else (0, 0, 0)
        if level == "structure":
            row["access_wta"], row["unique_access_minute_wta"], row["unique_access_wta"] = \
                acc_wta[key].values() if key in acc_wta else (0, 0, 0)
        rows[table].append(row)

    print(f"Events used: {stats['events']} (until {to_date}, only complete periods are written)")
    print("Events per connector: " + ", ".join(f"{m} ({n})" for m, n in per_module.most_common()))
    print("\nRows per table:")
    for table in sorted(rows):
        print(f"  stats.{table}: {len(rows[table])}")
    for level, entities in sorted(missing.items()):
        print(f"\nNot in repository.{level}s, rows skipped (foreign key): {len(entities)} {level}(s)")
    skipped = {k: v for k, v in stats.items() if k.startswith("skipped")}
    if skipped:
        print("\nSkipped events: " + ", ".join(f"{k}={v}" for k, v in skipped.items()))

    if args.dry_run or conn is None:
        print(f"\nDry run: {sum(len(r) for r in rows.values())} rows would be upserted")
        return
    written = 0
    with conn.cursor() as cur:
        for table, table_rows in sorted(rows.items()):
            columns = list(table_rows[0])
            updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in columns if c != "id")
            for i in range(0, len(table_rows), args.batch_size):
                batch = table_rows[i:i + args.batch_size]
                psycopg2.extras.execute_values(
                    cur, f"INSERT INTO stats.{table} ({', '.join(columns)}) VALUES %s "
                         f"ON CONFLICT (id) DO UPDATE SET {updates}",
                    [tuple(r[c] for c in columns) for r in batch])
                written += len(batch)
            conn.commit()
    print(f"\nUpserted rows: {written}")


if __name__ == "__main__":
    main()
