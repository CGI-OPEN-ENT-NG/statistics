-- Monthly partitions of the events.*_events tables, from the current month to +2 months (same naming as the
-- create-partitions action of the stats aggregator: <table>YYYYMM, brin index on date). The aggregator creates the next ones.
DO $$ DECLARE t text; m date; n text; BEGIN
  FOR t IN SELECT c.relname FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid
           JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'events' LOOP
    FOR i IN 0..2 LOOP
      m := (date_trunc('month', now()) + make_interval(months => i))::date;
      n := t || to_char(m, 'YYYYMM');
      IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = n) THEN
        EXECUTE format('CREATE TABLE events.%I PARTITION OF events.%I FOR VALUES FROM (%L) TO (%L)',
                       n, t, m, m + interval '1 month');
        EXECUTE format('CREATE INDEX ON events.%I USING brin (date)', n);
      END IF;
    END LOOP;
  END LOOP;
END $$;
