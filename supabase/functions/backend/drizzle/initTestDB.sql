CREATE SCHEMA IF NOT EXISTS cron AUTHORIZATION postgres;

CREATE OR REPLACE FUNCTION cron.schedule(a text, b text, c text)
RETURNS VOID AS $$
BEGIN
    -- This is a dummy function and doesn't do anything.
    -- You can replace this comment with actual functionality.
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cron.unschedule(a text)
RETURNS VOID AS $$
BEGIN
    -- This is a dummy function and doesn't do anything.
    -- You can replace this comment with actual functionality.
END;
$$ LANGUAGE plpgsql;
