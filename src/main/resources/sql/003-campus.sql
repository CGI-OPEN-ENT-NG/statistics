-- source is VARCHAR(6) in the official schema: Neo4j can hold "UNKNOWN" sources
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'structures', 'classes', 'users_structures', 'users_classes', 'users_tenants'] LOOP
    EXECUTE format('ALTER TABLE repository.%I ALTER COLUMN source TYPE varchar(16)', t);
  END LOOP;
END $$;

-- Copy every WebConference room event into events.connector_events, so that the stats aggregator counts the rooms
-- as connectors (type CONNECTOR, module = "cas-type" = WebConferenceRoomAccess / WebConferenceRoomCreation).
CREATE OR REPLACE FUNCTION events.room_event_to_connector() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO events.connector_events
        (id, date, platform_id, event_type, module, "cas-type", "connector-type", profile, user_id, ua, device_type, ip)
    VALUES
        (NEW.id, NEW.date, NEW.platform_id, 'CONNECTOR', NEW.module, TG_ARGV[0], 'WebConference', NEW.profile,
         NEW.user_id, NEW.ua, NEW.device_type, NEW.ip);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS room_access_to_connector ON events.room_access_events;
CREATE TRIGGER room_access_to_connector AFTER INSERT ON events.room_access_events
    FOR EACH ROW EXECUTE FUNCTION events.room_event_to_connector('WebConferenceRoomAccess');

DROP TRIGGER IF EXISTS room_creation_to_connector ON events.room_creation_events;
CREATE TRIGGER room_creation_to_connector AFTER INSERT ON events.room_creation_events
    FOR EACH ROW EXECUTE FUNCTION events.room_event_to_connector('WebConferenceRoomCreation');
