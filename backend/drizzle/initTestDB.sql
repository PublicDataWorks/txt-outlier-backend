CREATE SCHEMA IF NOT EXISTS cron AUTHORIZATION supabase_admin;

CREATE TABLE IF NOT EXISTS cron.call_history
(
  "id"            serial PRIMARY KEY NOT NULL,
  "function_name" text               NOT NULL,
  "parameters"    text               NOT NULL
);

TRUNCATE cron.call_history;

CREATE TABLE IF NOT EXISTS cron.job (
	"id" serial PRIMARY KEY NOT NULL,
	"jobname" text NOT NULL,
  "schedule" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "lookup_template" (
  "id" serial PRIMARY KEY NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "name" text NOT NULL,
  "content" text NOT NULL,
  "type" text NOT NULL
);

CREATE OR REPLACE FUNCTION cron.schedule(a text, b text, c text)
  RETURNS VOID AS
$$
BEGIN
  INSERT INTO cron.call_history (function_name, parameters)
  VALUES ('cron.schedule', a || ' ' || b || ' ' || c);
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION cron.unschedule(a text)
  RETURNS VOID AS
$$
BEGIN
  INSERT INTO cron.call_history (function_name, parameters)
  VALUES ('cron.unschedule', a);
END;
$$ LANGUAGE plpgsql;
