# Blocker Register

## 2026-06-16

- Local Supabase integration validation is blocked because the Docker daemon is unavailable at
  `unix:///Users/j/.docker/run/docker.sock`. The focused `make-tests.ts` suite cannot reach local Postgres at
  `127.0.0.1:54322` until the Supabase stack can start.
