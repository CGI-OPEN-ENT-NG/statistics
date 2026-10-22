-- Campus profiles (name of the KC_Profile nodes, e.g. "Gestionnaire d'inscription") are longer than the 9 characters
-- of the official schema: profile columns widened to 64 characters (no table rewrite for a varchar).
-- Partitions inherit the type of their partitioned table.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT col.table_schema, col.table_name
           FROM information_schema.columns col
           JOIN pg_class t ON t.relname = col.table_name
           JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = col.table_schema
           WHERE col.table_schema IN ('events', 'stats', 'repository')
             AND col.column_name = 'profile' AND col.character_maximum_length < 64
             AND NOT t.relispartition LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN profile TYPE varchar(64)', c.table_schema, c.table_name);
  END LOOP;
END $$;
