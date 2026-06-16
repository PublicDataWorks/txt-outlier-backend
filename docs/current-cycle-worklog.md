# Current Cycle Worklog

## 2026-06-16

- Added migration `20260616090000_exclude_csv_upload_from_broadcasts.sql` to exclude authors from broadcast queueing
  when they have `added_via_file_upload = true` or are connected to a non-archived `CSV UPLOAD` label.
- Added focused regression coverage in `make-tests.ts` for an existing author connected to a `CSV UPLOAD` label.
- Added the migration to the test setup migration list.
- Updated `README.md` developer notes to document the CSV label exclusion.
- Ran `deno lint` successfully.
- Attempted `TZ=UTC deno test --no-check --no-lock --allow-all --env=.env.testing make-tests.ts`; blocked because
  Docker is not running and local Supabase Postgres is unavailable.
- Started PR and production deployment follow-up for the CSV upload broadcast exclusion.
- Opened draft PR: https://github.com/PublicDataWorks/txt-outlier-backend/pull/102.
- Applied production Supabase migration `20260616162541 exclude_csv_upload_from_broadcasts` to project
  `TXT Outlier` (`pshrrdazlftosdtoevpf`).
- Verified `public.is_broadcast_excluded_recipient('__codex_nonexistent_phone__')` returns `false` and the helper exists
  in production.
- Ran Supabase security and performance advisors after DDL. Results were existing project-wide warnings; the new
  broadcast functions were not reported as mutable-search-path findings.
