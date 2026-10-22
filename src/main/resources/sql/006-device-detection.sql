-- Device detection of the stats aggregator (its migrations 007 and 016): user agents and their device type, keyed by
-- user agent (INSERT ... ON CONFLICT (ua)), and index on the user agent of the logins read by the detection.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'utils.ua_device'::regclass AND contype = 'p') THEN
    ALTER TABLE utils.ua_device ADD PRIMARY KEY (ua);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS login_events_ua_idx ON events.login_events (ua);
