# Run Receipt

## 2026-06-16

Task: Exclude recipients with the `CSV UPLOAD` label from normal broadcast segments.

Outcome:
- Implemented a database-level broadcast recipient exclusion helper.
- Replaced `queue_broadcast_messages` so regular and Inactive segment fill paths skip CSV-upload recipients.
- Added regression coverage for a labeled existing author.
- Recorded the validation blocker in `docs/blocker-register.md`.

Validation:
- Passed: `deno lint`.
- Blocked: focused `make-tests.ts` integration run because Docker is not running and local Supabase Postgres is not
  accepting connections on `127.0.0.1:54322`.

Required workflow artifacts:
- `WORKFLOW.md` was not present in this checkout before implementation.
- Execution board, blocker register, current-cycle worklog, reference index, and this run receipt were created under
  `docs/` because no existing copies were found.

Follow-up:
- PR creation and production deployment requested on 2026-06-16.
- Opened draft PR https://github.com/PublicDataWorks/txt-outlier-backend/pull/102.
- Deployed to production Supabase project `TXT Outlier` (`pshrrdazlftosdtoevpf`) as migration
  `20260616162541 exclude_csv_upload_from_broadcasts`.
- Production smoke check confirmed the exclusion helper exists and returns `false` for a nonexistent phone number.
- Supabase advisors still report existing project-wide warnings, including RLS-enabled tables with no policies,
  mutable search paths on unrelated functions, extension-in-public warnings, and available Postgres security patches.
- PR review hardening follow-up deployed to production as migration
  `20260616162907 harden_csv_upload_broadcast_exclusion`.
- The final production version drops `public.is_broadcast_excluded_recipient(text)`, precomputes excluded broadcast
  recipients in a temporary table inside `queue_broadcast_messages`, uses `search_path=public, pg_temp`, and orders
  batch pagination by `phone_number`.
