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
