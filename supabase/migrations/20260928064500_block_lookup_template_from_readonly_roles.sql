-- public.lookup_template stores live API credentials alongside SMS templates and prompts.
-- Row id=30 (name='missive_secret', type='lookup_context') holds the Missive API token as raw
-- content -- it contains no "token"/"secret" keyword in the value itself, so keyword scans miss it.
--
-- The analyst read-only roles were granted SELECT on all 38 public tables, which included this one.
-- Blocking the entire table rather than filtering the single row: the table mixes configuration
-- with secrets, so any future credential added here would otherwise be exposed automatically.
--
-- Both the grant and the RLS policy must go. Dropping only the policy would still leave the grant,
-- and a future policy change could silently re-expose the table.
--
-- Applied to production as 20260928064500. These roles exist only in production, so each role is
-- handled on its own: an existing role always loses its grant and policy, and an absent one is
-- skipped. A fresh database (CI's `supabase start`, local development) has none of them and skips
-- the whole migration.

DO $guard$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['readonly_outlier', 'readonly_kate', 'address-lookup-readonly'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      RAISE NOTICE 'Skipping 20260928064500 for role %: role does not exist', r;
      CONTINUE;
    END IF;

    EXECUTE format('revoke select on public.lookup_template from %I', r);
    EXECUTE format('drop policy if exists %I on public.lookup_template', r || ' read access');
  END LOOP;
END
$guard$;
