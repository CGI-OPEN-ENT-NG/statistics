#!/usr/bin/env python3
"""Fill the stats.accounts_* and stats.access_* tables from MongoDB, for the periods before the switch of the event
store to PostgreSQL.

Values are computed like com.opendigitaleducation.stats.aggregation.AccountsAggregation / AccessAggregation, but
structures and classes come from the event itself (state at the time of the event) instead of the current repository:
- accounts: authentications, unique_visitors (LOGIN of Auth / app-e / Application Mobile), activations (ACTIVATION),
  loaded / activated from the monthly snapshots of statistics-old (collection "stats", ACCOUNTS / ACTIVATED_ACCOUNTS);
- access: ACCESS events (type ACCESS), CONNECTOR events (type CONNECTOR, module = cas-type or module) and
  ROOM_ACCESS / ROOM_CREATION events as the WebConferenceRoomAccess / WebConferenceRoomCreation connectors.
Events before --to-date are used, the period containing --to-date is written partially: run the native aggregator
afterwards without "dates-interval", it restarts from DATE_TRUNC(MAX(date)) of each table and recomputes it entirely.
Row ids are the aggregator ones, so both write the same rows. MongoDB is only read. Device tables are not filled.

Profiles are the Campus profiles of the events in PostgreSQL (given by remap_profiles.py, run it first); an event
missing in PostgreSQL gets the one of its person like remap_profiles.py. The statistics-old loaded / activated of an
ENT profile are split between its Campus profiles (campus_profiles.py).

Requirements: pip install pymongo==4.17.0 psycopg2-binary (pymongo 4.18+ requires MongoDB 4.4)
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

from campus_profiles import campus_profile, campus_profiles, split_count

ROOM_MODULES = {"ROOM_ACCESS": "WebConferenceRoomAccess", "ROOM_CREATION": "WebConferenceRoomCreation"}
LOGIN_MODULES = {"Auth", "app-e", "Application Mobile"}
FREQUENCIES = ("hour", "day", "week", "month")
LEVELS = ("platform", "tenant", "structure", "class")
INDICATORS = ("accounts", "access")
ACCOUNT_VALUES = ("loaded", "activated", "authentications", "unique_visitors", "activations", "sessions")
ACCESS_VALUES = ("access", "unique_access_minute", "unique_access")
# events table giving the profile of each kind of MongoDB event (rooms are counted as connectors)
EVENT_TABLES = {"LOGIN": "login_events", "ACTIVATION": "activation_events", "ACCESS": "access_events",
                "CONNECTOR": "connector_events", "ROOM_ACCESS": "connector_events", "ROOM_CREATION": "connector_events"}


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--mongo-uri", required=True)
    p.add_argument("--mongo-db", required=True)
    p.add_argument("--mongo-collection", default="events")
    p.add_argument("--legacy-stats-collection", default="stats",
                   help="statistics-old aggregates used for loaded / activated ('' to skip)")
    p.add_argument("--pg-dsn", help="ex: postgresql://user:pwd@host:5432/db (optional with --dry-run)")
    p.add_argument("--platform-id", required=True, help="value of event-store.platform in ent-core conf")
    p.add_argument("--timezone", default="Europe/Paris", help="JVM timezone of ent-core")
    p.add_argument("--from-date", help="first local date to process (ISO)")
    p.add_argument("--to-date", required=True, help="local date of the event store switch (ISO), excluded")
    p.add_argument("--indicators", default=",".join(INDICATORS))
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


def row_id(platform_id, date, entity, profile, extra=()):
    # Same id as the aggregator (AbstractAggregation#generateId + Sha256#hash): concatenation of the hashed columns
    # (platform_id, date as Java LocalDateTime, profile [, type, module]) and of the entity id except for the platform
    key = platform_id + f"{date:%Y-%m-%dT%H:%M}" + profile + "".join(extra) + entity
    return hashlib.sha256(key.encode("utf-8")[:len(key)]).hexdigest()


class Repository:
    def __init__(self, conn, platform_id):
        self.available = conn is not None
        self.parents = {}
        self.tenant_of = {}
        self.classes = set()
        self.tenants = set()
        self.columns = {}
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
            cur.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'stats'")
            for table, column in cur.fetchall():
                self.columns.setdefault(table, set()).add(column)

    def direct_structures(self, structures):
        ancestors = set()
        for s in structures:
            ancestors |= self.parents.get(s, set())
        return [s for s in structures if s not in ancestors]

    def known(self, level, entity):
        if not self.available or level == "platform":
            return True
        return entity in {"structure": self.parents, "class": self.classes, "tenant": self.tenants}[level]


def load_event_profiles(conn, platform_id, to_date):
    """Profile of the events in PostgreSQL, by table and event id."""
    profiles = defaultdict(dict)
    if conn is None:
        return profiles
    with conn.cursor() as cur:
        for table in sorted(set(EVENT_TABLES.values())):
            cur.execute(f"SELECT id::text, profile FROM events.{table} WHERE platform_id = %s AND date < %s",
                        (platform_id, to_date))
            profiles[table] = dict(cur.fetchall())
    return profiles


class Values:
    def __init__(self):
        self.count = 0
        self.users = set()
        self.minutes = set()
        self.activated_users = set()


def main():
    args = parse_args()
    if not args.dry_run and not args.pg_dsn:
        sys.exit("--pg-dsn is required unless --dry-run")
    tz = ZoneInfo(args.timezone)
    indicators = [i for i in args.indicators.split(",") if i]
    levels = [lv for lv in args.levels.split(",") if lv]
    frequencies = [f for f in args.frequencies.split(",") if f]
    to_date = datetime.fromisoformat(args.to_date).replace(tzinfo=None)
    from_date = datetime.fromisoformat(args.from_date).replace(tzinfo=None) if args.from_date else None

    conn = psycopg2.connect(args.pg_dsn) if args.pg_dsn else None
    repo = Repository(conn, args.platform_id)
    if not repo.available:
        print("No --pg-dsn: *_wta uses all structures and entities are not checked against the repository")

    event_types = []
    if "access" in indicators:
        event_types += ["ACCESS", "CONNECTOR"] + list(ROOM_MODULES)
    if "accounts" in indicators:
        event_types += ["LOGIN", "ACTIVATION"]
    query = {"event-type": {"$in": event_types},
             "date": {"$lt": int(to_date.replace(tzinfo=tz).timestamp() * 1000)}}
    if from_date:
        query["date"]["$gte"] = int(from_date.replace(tzinfo=tz).timestamp() * 1000)
    db = MongoClient(args.mongo_uri)[args.mongo_db]
    event_profiles = load_event_profiles(conn, args.platform_id, to_date)

    # key: (indicator, wta, level, frequency, start, entity, profile, type, module)
    values = defaultdict(Values)
    stats = Counter()
    per_kind = Counter()

    def periods(minute):
        for frequency in frequencies:
            yield frequency, period_start(minute, frequency)

    for doc in db[args.mongo_collection].find(query, {"ua": 0, "ip": 0, "groups": 0}):
        user, date = doc.get("userId"), doc.get("date")
        if not user or not isinstance(date, (int, float)):
            stats["skipped_no_user_or_date"] += 1
            continue
        event_type = doc["event-type"]
        profile = event_profiles[EVENT_TABLES[event_type]].get(str(doc["_id"]))
        if profile is None:
            profile = campus_profile(doc.get("profil"), user)
            stats["profile_not_in_postgresql"] += 1
        if event_type == "LOGIN":
            if doc.get("module") not in LOGIN_MODULES:
                stats["skipped_login_module"] += 1
                continue
            indicator, kind, module = "accounts", "LOGIN", ""
        elif event_type == "ACTIVATION":
            indicator, kind, module = "accounts", "ACTIVATION", ""
        elif event_type == "ACCESS":
            indicator, kind, module = "access", "ACCESS", doc.get("module")
        else:
            indicator, kind = "access", "CONNECTOR"
            module = ROOM_MODULES.get(event_type) or doc.get("cas-type") or doc.get("module")
        if indicator == "access" and not module:
            stats["skipped_no_module"] += 1
            continue
        stats["events"] += 1
        per_kind[f"{kind} {module}".strip()] += 1
        minute = datetime.fromtimestamp(date / 1000, tz).replace(tzinfo=None, second=0, microsecond=0)
        structures = [s for s in (doc.get("structures") or []) if s]
        entities = {"platform": [""], "structure": structures,
                    "class": [c for c in (doc.get("classes") or []) if c],
                    "tenant": sorted({repo.tenant_of[s] for s in structures if s in repo.tenant_of})}
        direct = repo.direct_structures(structures) if repo.available else structures
        access_type = kind if indicator == "access" else ""
        for frequency, start in periods(minute):
            targets = [(False, level, entity) for level in levels for entity in entities[level]]
            if "structure" in levels:
                targets += [(True, "structure", entity) for entity in direct]
            for wta, level, entity in targets:
                v = values[(indicator, wta, level, frequency, start, entity, profile, access_type, module)]
                if kind == "ACTIVATION":
                    v.activated_users.add(user)
                else:
                    v.count += 1
                    v.users.add(user)
                    if indicator == "access":
                        v.minutes.add((minute, user))

    snapshots = defaultdict(lambda: [0, 0])  # (level, entity, profile, month) -> [loaded, activated]
    if "accounts" in indicators and args.legacy_stats_collection:
        legacy = {}
        for doc in db[args.legacy_stats_collection].find(
                {"ACCOUNTS": {"$exists": True}, "groupedBy": "structures/profil"},
                {"date": 1, "structures_id": 1, "profil_id": 1, "ACCOUNTS": 1, "ACTIVATED_ACCOUNTS": 1}):
            if not doc.get("structures_id") or not doc.get("profil_id"):
                continue
            month = datetime.strptime(doc["date"][:10], "%Y-%m-%d").replace(day=1)
            if month >= to_date or (from_date and month < period_start(from_date, "month")):
                continue
            legacy[(doc["structures_id"], doc["profil_id"], month)] = (doc.get("ACCOUNTS") or 0,
                                                                       doc.get("ACTIVATED_ACCOUNTS") or 0)
        for (structure, legacy_profile, month), (loaded, activated) in legacy.items():
            profiles = campus_profiles(legacy_profile) or [legacy_profile]
            loaded_split, activated_split = split_count(loaded, profiles), split_count(activated, profiles)
            for profile in profiles:
                for level, entity in (("structure", structure), ("platform", ""),
                                      ("tenant", repo.tenant_of.get(structure))):
                    if entity is None or level not in levels:
                        continue
                    snapshot = snapshots[(level, entity, profile, month)]
                    snapshot[0] += loaded_split[profile]
                    snapshot[1] += activated_split[profile]
        stats["legacy_snapshots"] = len(legacy)
        if "month" in frequencies:
            for (level, entity, profile, month) in snapshots:
                values[("accounts", False, level, "month", month, entity, profile, "", "")]
                if level == "structure":
                    values[("accounts", True, level, "month", month, entity, profile, "", "")]

    merged = {}
    missing = defaultdict(set)
    for (indicator, wta, level, frequency, start, entity, profile, access_type, module), v in values.items():
        if not repo.known(level, entity):
            missing[level].add(entity)
            continue
        table = f"{indicator}_{level}_{frequency}s"
        extra = (access_type, module) if indicator == "access" else ()
        rid = row_id(args.platform_id, start, entity, profile, extra)
        row = merged.get((table, rid))
        if row is None:
            row = {"id": rid, "platform_id": args.platform_id, "date": start, "profile": profile}
            if level != "platform":
                row[f"{level}_id"] = entity
            names = ACCESS_VALUES if indicator == "access" else ACCOUNT_VALUES
            for name in names:
                row[name] = 0
                if level == "structure":
                    row[f"{name}_wta"] = 0
            if indicator == "access":
                row["type"], row["module"] = access_type, module
            merged[(table, rid)] = row
        suffix = "_wta" if wta else ""
        if indicator == "access":
            row["access" + suffix] = v.count
            row["unique_access_minute" + suffix] = len(v.minutes)
            row["unique_access" + suffix] = len(v.users)
        else:
            row["authentications" + suffix] = v.count
            row["unique_visitors" + suffix] = len(v.users)
            row["activations" + suffix] = len(v.activated_users)
            loaded, activated = snapshots.get((level, entity, profile, period_start(start, "month")), (0, 0))
            row["loaded" + suffix], row["activated" + suffix] = loaded, activated

    rows = defaultdict(list)
    for (table, _), row in merged.items():
        allowed = repo.columns.get(table)
        rows[table].append({k: v for k, v in row.items() if allowed is None or k in allowed})

    print(f"Events used: {stats['events']} (until {to_date})")
    print("Events per kind: " + ", ".join(f"{k} ({n})" for k, n in per_kind.most_common()))
    if stats["legacy_snapshots"]:
        print(f"statistics-old loaded/activated snapshots: {stats['legacy_snapshots']}")
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
