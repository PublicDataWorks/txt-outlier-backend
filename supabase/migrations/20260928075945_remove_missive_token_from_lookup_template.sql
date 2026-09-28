-- Removes the live Missive API token from public.lookup_template and takes write access to that
-- table away from the anon/authenticated roles.
--
-- NOT YET APPLIED. Unlike the other migrations in this directory, this one is proposed rather than
-- recorded after the fact. Apply it only after working through docs/application-secrets.md --
-- specifically, the token must be rotated in Missive, because deleting the row does not
-- un-expose a value that has been sitting in every database backup.
--
-- Background: row name='missive_secret' held the Missive API token as plaintext `content`. The
-- only consumer was txt-outlier-lookups, which switched to reading MISSIVE_SECRET from the
-- environment in PR #82 (merged 2025-10-27). The row has been orphaned ever since, but its value
-- still matches the live token in 1Password, so it remained a real credential sitting in a data
-- table that three analyst roles could read until 2026-09-27.

delete from public.lookup_template where name = 'missive_secret';

-- anon and authenticated hold SELECT/INSERT/UPDATE/DELETE/TRUNCATE on this table. Nothing uses
-- them: every real consumer connects as the table owner (edge functions via DB_POOL_URL) or as
-- service_role. They are currently inert only because RLS is enabled with no policy covering them
-- -- a single permissive policy, or RLS being switched off, would expose the whole config table
-- (and any future credential in it) to the public anon key, with write access on top.
revoke all on public.lookup_template from anon;
revoke all on public.lookup_template from authenticated;
