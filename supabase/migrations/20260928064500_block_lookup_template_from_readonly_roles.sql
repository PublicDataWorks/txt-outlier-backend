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

revoke select on public.lookup_template from readonly_outlier;
revoke select on public.lookup_template from readonly_kate;
revoke select on public.lookup_template from "address-lookup-readonly";

drop policy if exists "readonly_outlier read access" on public.lookup_template;
drop policy if exists "readonly_kate read access" on public.lookup_template;
drop policy if exists "address-lookup-readonly read access" on public.lookup_template;
