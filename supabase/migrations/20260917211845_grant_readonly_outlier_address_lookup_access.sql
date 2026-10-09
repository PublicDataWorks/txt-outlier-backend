-- Extends readonly_outlier's analyst access to the address_lookup schema (Detroit parcel,
-- rental registration, and tax-foreclosure windfall data) alongside the public schema access
-- granted in 20260917211629. readonly_outlier previously had no USAGE on this schema at all.
--
-- Note: PostGIS lives in the `extensions` schema, which readonly_outlier cannot access, so the
-- wkb_geometry columns are not queryable via ST_* functions. Every table here also carries plain
-- lat/lon columns, which is what analyst queries should use.
--
-- Applied to production as 20260917211845. The roles and schemas it touches exist only in production, so
-- the statements run only when role readonly_outlier, schema address_lookup exist. A fresh database (CI's `supabase start`,
-- local development) skips this migration instead of failing.

DO $guard$
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_outlier')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'address_lookup')) THEN
    RAISE NOTICE 'Skipping 20260917211845: requires role readonly_outlier, schema address_lookup';
    RETURN;
  END IF;

  EXECUTE $migration$
grant usage on schema address_lookup to readonly_outlier;

grant select on address_lookup.mi_wayne_detroit to readonly_outlier;
grant select on address_lookup.residential_rental_registrations to readonly_outlier;
grant select on address_lookup.posible_homeowner_windfalls to readonly_outlier;

-- mi_wayne_detroit and residential_rental_registrations have RLS disabled, so the grant alone is
-- sufficient. posible_homeowner_windfalls has RLS enabled with no policies, so it needs an explicit
-- policy or it would silently return zero rows like the public tables did.
create policy "readonly_outlier read access" on address_lookup.posible_homeowner_windfalls
  for select to readonly_outlier using (true);
$migration$;
END
$guard$;
