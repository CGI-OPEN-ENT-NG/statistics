#!/usr/bin/env python3
"""Campus profiles for the events written before them (see campus_profiles.py).

1. events.*_events: each person with events of an ENT profile (or none) gets one of the Campus profiles of this ENT
   profile, always the same (hash of the user id), and all these events get it: unique visitors stay exact.
   Only the ENT profiles are changed: the script can be run again.
2. stats.*: the rows with an ENT profile are deleted. backfill_stats.py then writes the history with the Campus
   profiles of the events, and the aggregator recomputes the current periods.

--revert first gives back their ENT profile to the events with a Campus profile of this mapping and deletes their
stats rows: only before ent-core writes Campus profiles itself (it would revert them too).

The profile columns must accept the Campus profiles (sql/007-profile-length.sql of the stats module).
"""
import argparse
import sys

import psycopg2
from psycopg2 import sql

from campus_profiles import HASH_DIGITS, LEGACY_PROFILES, NO_PROFILE, NO_PROFILE_VALUES

LEGACY_VALUES = list(LEGACY_PROFILES) + NO_PROFILE_VALUES
CAMPUS_VALUES = sorted({p for profiles in LEGACY_PROFILES.values() for p in profiles} | set(NO_PROFILE))
MIN_PROFILE_LENGTH = max(len(p) for p in CAMPUS_VALUES)


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pg-dsn", required=True, help="ex: postgresql://user:pwd@host:5432/db (owner of the tables)")
    p.add_argument("--platform-id", required=True, help="value of event-store.platform")
    p.add_argument("--revert", action="store_true",
                   help="first give back their ENT profile to the events with a Campus profile of this mapping")
    p.add_argument("--keep-stats", action="store_true", help="do not delete the stats rows with an ENT profile")
    p.add_argument("--dry-run", action="store_true", help="count only, nothing is written")
    return p.parse_args()


def tables_with_profile(cur, schema):
    cur.execute("""
        SELECT c.table_name, c.character_maximum_length FROM information_schema.columns c
        JOIN information_schema.columns p ON p.table_schema = c.table_schema AND p.table_name = c.table_name
             AND p.column_name = 'platform_id'
        JOIN pg_class t ON t.relname = c.table_name
        JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema
        WHERE c.table_schema = %s AND c.column_name = 'profile' AND NOT t.relispartition
        ORDER BY 1""", (schema,))
    return cur.fetchall()


def campus_profile_case():
    """CASE giving the Campus profile of an event from its ENT profile and the hash of its user id."""
    index = sql.SQL("('x' || substr(md5(coalesce(user_id, '')), 1, {}))::bit({})::int").format(
        sql.Literal(HASH_DIGITS), sql.Literal(HASH_DIGITS * 4))
    whens = [sql.SQL("WHEN {} THEN ({})[mod({}, {}) + 1]").format(
        sql.Literal(legacy), sql.Literal(profiles), index, sql.Literal(len(profiles)))
        for legacy, profiles in LEGACY_PROFILES.items()]
    return sql.SQL("CASE coalesce(profile, '') {} ELSE ({})[mod({}, {}) + 1] END").format(
        sql.SQL(" ").join(whens), sql.Literal(NO_PROFILE), index, sql.Literal(len(NO_PROFILE)))


def legacy_profile_case():
    """CASE giving back the ENT profile of a Campus profile of this mapping."""
    whens = [sql.SQL("WHEN {} THEN {}").format(sql.Literal(campus), sql.Literal(legacy))
             for legacy, profiles in LEGACY_PROFILES.items() for campus in profiles]
    return sql.SQL("CASE profile {} ELSE profile END").format(sql.SQL(" ").join(whens))


def run(cur, dry_run, query, params, label):
    if dry_run:
        cur.execute(sql.SQL("SELECT count(*) FROM ({}) q").format(query), params)
        n = cur.fetchone()[0]
    else:
        cur.execute(query, params)
        n = cur.rowcount
    if n:
        print(f"  {label}: {n}")


def main():
    args = parse_args()
    conn = psycopg2.connect(args.pg_dsn)
    with conn, conn.cursor() as cur:
        events_tables = [t for t, _ in tables_with_profile(cur, "events")]
        stats_tables = [t for t, _ in tables_with_profile(cur, "stats")]
        too_short = [t for t, length in tables_with_profile(cur, "events") if length and length < MIN_PROFILE_LENGTH]
        if too_short and not args.dry_run:
            sys.exit(f"profile column shorter than {MIN_PROFILE_LENGTH} characters in events.{', events.'.join(too_short)}:"
                     " start the stats module first (sql/007-profile-length.sql)")

        if args.revert:
            print("Events given back their ENT profile:")
            where = sql.SQL("platform_id = %s AND profile = ANY(%s)")
            for table in events_tables:
                query = (sql.SQL("SELECT 1 FROM events.{} WHERE {}").format(sql.Identifier(table), where)
                         if args.dry_run else
                         sql.SQL("UPDATE events.{} SET profile = {} WHERE {}").format(
                             sql.Identifier(table), legacy_profile_case(), where))
                run(cur, args.dry_run, query, (args.platform_id, CAMPUS_VALUES), f"events.{table}")
            print("Stats rows with a Campus profile of this mapping (deleted):")
            for table in stats_tables:
                verb = "SELECT 1 FROM" if args.dry_run else "DELETE FROM"
                query = sql.SQL(verb + " stats.{} WHERE platform_id = %s AND profile = ANY(%s)").format(
                    sql.Identifier(table))
                run(cur, args.dry_run, query, (args.platform_id, CAMPUS_VALUES), f"stats.{table}")

        print("Events with an ENT profile:")
        legacy = sql.SQL("platform_id = %s AND (profile IS NULL OR profile = ANY(%s))")
        for table in events_tables:
            query = (sql.SQL("SELECT 1 FROM events.{} WHERE {}").format(sql.Identifier(table), legacy)
                     if args.dry_run else
                     sql.SQL("UPDATE events.{} SET profile = {} WHERE {}").format(
                         sql.Identifier(table), campus_profile_case(), legacy))
            run(cur, args.dry_run, query, (args.platform_id, LEGACY_VALUES), f"events.{table}")

        if not args.keep_stats:
            print("Stats rows with an ENT profile (deleted):")
            for table in stats_tables:
                verb = "SELECT 1 FROM" if args.dry_run else "DELETE FROM"
                query = sql.SQL(verb + " stats.{} WHERE {}").format(sql.Identifier(table), legacy)
                run(cur, args.dry_run, query, (args.platform_id, LEGACY_VALUES), f"stats.{table}")
        if args.dry_run:
            conn.rollback()
            print("Dry run: nothing written")


if __name__ == "__main__":
    main()
