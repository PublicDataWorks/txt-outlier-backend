# Execution Board

## Current Cycle

- [x] 2026-06-16: Exclude CSV UPLOAD recipients from broadcast segments.
  - State: Implemented with migration and regression coverage.
  - Validation: `deno lint` passed; focused Supabase test blocked by local Docker daemon being unavailable.
- [x] 2026-06-16: Publish PR and deploy CSV upload broadcast exclusion to production.
  - State: PR opened and production migration applied.
  - Validation: Production migration recorded and helper smoke check passed.
