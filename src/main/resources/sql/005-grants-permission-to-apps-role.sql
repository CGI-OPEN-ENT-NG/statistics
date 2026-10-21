-- The tables belong to the admin user (sql scripts of the module, stats aggregator: owner of the partitioned tables,
-- to create their partitions). The ENT user writes the events (event store) and reads the statistics (module).
DO $$ DECLARE s text; BEGIN
  FOREACH s IN ARRAY ARRAY['events', 'external', 'repository', 'stats', 'utils'] LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO "apps"', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA %I TO "apps"', s);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO "apps"', s);
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO "apps"', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO "apps"', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO "apps"', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "apps"', s);
  END LOOP;
END $$;
