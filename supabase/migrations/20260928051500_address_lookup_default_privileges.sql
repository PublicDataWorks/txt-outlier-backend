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
-- Applied to production as 20260928051500. The roles and schemas it touches exist only in production, so
-- the statements run only when role readonly_outlier, role readonly_kate, role address-lookup-readonly, schema address_lookup exist. A fresh database (CI's `supabase start`,
-- local development) skips this migration instead of failing.

DO $guard$
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_outlier')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_kate')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'address-lookup-readonly')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'address_lookup')) THEN
    RAISE NOTICE 'Skipping 20260928051500: requires role readonly_outlier, role readonly_kate, role address-lookup-readonly, schema address_lookup';
    RETURN;
  END IF;

  EXECUTE $migration$
grant select on address_lookup.mi_wayne_detroit to readonly_outlier;
grant select on address_lookup.residential_rental_registrations to readonly_outlier;

alter default privileges for role postgres in schema address_lookup
  grant select on tables to readonly_outlier;
alter default privileges for role postgres in schema address_lookup
  grant select on tables to readonly_kate;
alter default privileges for role postgres in schema address_lookup
  grant select on tables to "address-lookup-readonly";
$migration$;
END
$guard$;
