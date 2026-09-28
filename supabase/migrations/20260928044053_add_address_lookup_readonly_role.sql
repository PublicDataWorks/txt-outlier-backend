-- Creates "address-lookup-readonly", a login role scoped to the address_lookup schema only.
-- Unlike readonly_outlier (which has full read access to resident PII), this role is deliberately
-- limited to Detroit property data and cannot read the public, legacy, media, or vault schemas.
--
-- The password is NOT in this migration. It was generated out-of-band and stored in 1Password:
-- vault "Outlier" -> item "Supabase address-lookup-readonly (TXT Outlier)".
-- The role is created here without a password, so it cannot authenticate until one is set with
--   alter role "address-lookup-readonly" password '<value from 1Password>';
-- On the live project the role already exists with its password set; the guard below makes this
-- migration a no-op there.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'address-lookup-readonly') then
    create role "address-lookup-readonly" with login nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end
$$;

grant usage on schema address_lookup to "address-lookup-readonly";

grant select on address_lookup.mi_wayne_detroit to "address-lookup-readonly";
grant select on address_lookup.residential_rental_registrations to "address-lookup-readonly";
grant select on address_lookup.posible_homeowner_windfalls to "address-lookup-readonly";

-- Only posible_homeowner_windfalls has RLS enabled; the other two have RLS off, so the grant alone
-- is sufficient there. Without this policy the role would silently read zero rows from it.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'address_lookup'
      and tablename = 'posible_homeowner_windfalls'
      and policyname = 'address-lookup-readonly read access'
  ) then
    create policy "address-lookup-readonly read access"
      on address_lookup.posible_homeowner_windfalls
      for select to "address-lookup-readonly" using (true);
  end if;
end
$$;
