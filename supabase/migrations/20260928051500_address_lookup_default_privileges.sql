-- The address_lookup refresh pipeline (Regrid SFTP feed) recreates mi_wayne_detroit and
-- residential_rental_registrations rather than updating them in place. Recreating a table drops
-- every grant on it, so read-only roles silently lose access on each refresh.
--
-- Evidence: readonly_outlier was granted SELECT on all three address_lookup tables on 2026-09-17
-- (migration 20260917211845) and verified at the time. By 2026-09-27 its grants on
-- mi_wayne_detroit and residential_rental_registrations were gone, while its grant on
-- posible_homeowner_windfalls -- the one table the pipeline does NOT recreate -- survived.
-- The parcel row count also moved (378,049 -> 377,987), confirming a refresh ran in between.
--
-- Two fixes below: restore the lost grants, and set default privileges so tables created in this
-- schema by postgres (the owner the pipeline runs as) carry the SELECT grants automatically.
--
-- Applied to production as 20260928051500. These roles and the address_lookup schema exist only in
-- production, so each role is handled on its own: an existing role always gets its grants and default
-- privileges, and an absent one is skipped. A fresh database (CI's `supabase start`, local
-- development) has no address_lookup schema and skips the whole migration.

DO $guard$
DECLARE
  r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'address_lookup') THEN
    RAISE NOTICE 'Skipping 20260928051500: requires schema address_lookup';
    RETURN;
  END IF;

  FOREACH r IN ARRAY ARRAY['readonly_outlier', 'readonly_kate', 'address-lookup-readonly'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      RAISE NOTICE 'Skipping 20260928051500 for role %: role does not exist', r;
      CONTINUE;
    END IF;

    -- Only readonly_outlier had lost its grants on the two recreated tables.
    IF r = 'readonly_outlier' THEN
      EXECUTE format('grant select on address_lookup.mi_wayne_detroit to %I', r);
      EXECUTE format('grant select on address_lookup.residential_rental_registrations to %I', r);
    END IF;

    EXECUTE format('alter default privileges for role postgres in schema address_lookup grant select on tables to %I', r);
  END LOOP;
END
$guard$;
