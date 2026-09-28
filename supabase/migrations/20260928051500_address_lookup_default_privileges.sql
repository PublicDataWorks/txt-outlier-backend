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

grant select on address_lookup.mi_wayne_detroit to readonly_outlier;
grant select on address_lookup.residential_rental_registrations to readonly_outlier;

alter default privileges for role postgres in schema address_lookup
  grant select on tables to readonly_outlier;
alter default privileges for role postgres in schema address_lookup
  grant select on tables to readonly_kate;
alter default privileges for role postgres in schema address_lookup
  grant select on tables to "address-lookup-readonly";
