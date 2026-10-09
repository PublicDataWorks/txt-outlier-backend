-- Widens "address-lookup-readonly" from address_lookup-only to full-database read access.
-- Despite its name, this role now reads all project data, including resident PII: SMS message
-- bodies, phone numbers, webhook/error logs, and AI conversation summaries. The 1Password item
-- ("Supabase address-lookup-readonly (TXT Outlier)", Outlier vault) documents the widened scope.
--
-- Deliberately NOT granted: vault (decrypts the service_role key in plaintext -- granting it would
-- turn this read-only role into a full-admin escalation path), auth (password hashes, refresh
-- tokens), and pgsodium (encryption key material). A handful of storage/realtime tables owned by
-- supabase_storage_admin / supabase_realtime_admin are also unreachable, because postgres does not
-- own them and therefore cannot grant on them. None of those hold project data.
--
-- Every table in the public schema has RLS enabled, so a SELECT grant alone is not enough --
-- without a matching policy Postgres silently returns zero rows. The loop below creates a policy
-- for every RLS-enabled relation it can, alongside the grant.
--
-- Applied to production as 20260928055000. The roles and schemas it touches exist only in production, so
-- the statements run only when role address-lookup-readonly exist. A fresh database (CI's `supabase start`,
-- local development) skips this migration instead of failing.

DO $guard$
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'address-lookup-readonly')) THEN
    RAISE NOTICE 'Skipping 20260928055000: requires role address-lookup-readonly';
    RETURN;
  END IF;

  EXECUTE $migration$
do $$
declare
  r record;
  tgt constant text := 'address-lookup-readonly';
  schemas constant text[] := array['public','address_lookup','legacy','media','cron','pgmq',
                                   'net','supabase_functions','supabase_migrations','realtime',
                                   'storage','extensions','graphql_public','pgmq_public'];
  s text;
begin
  foreach s in array schemas loop
    begin
      execute format('grant usage on schema %I to %I', s, tgt);
    exception when others then null;
    end;
  end loop;

  for r in
    select n.nspname as sch, c.relname as rel, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p','v','m') and n.nspname = any(schemas)
  loop
    begin
      execute format('grant select on %I.%I to %I', r.sch, r.rel, tgt);
    exception when others then null;
    end;

    if r.rls then
      begin
        execute format('create policy %I on %I.%I for select to %I using (true)',
                       tgt || ' read access', r.sch, r.rel, tgt);
      exception
        when duplicate_object then null;
        when others then null;
      end;
    end if;
  end loop;

  -- keep access working when the address_lookup refresh recreates tables, and for any new tables
  foreach s in array schemas loop
    begin
      execute format('alter default privileges for role postgres in schema %I grant select on tables to %I', s, tgt);
    exception when others then null;
    end;
  end loop;
end
$$;
$migration$;
END
$guard$;
