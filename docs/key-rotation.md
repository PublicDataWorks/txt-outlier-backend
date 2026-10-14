# Rotating the secret key

For Missive, Twilio, OpenAI and other application credentials — which live in edge function
environment variables rather than Vault — see [application-secrets.md](application-secrets.md).

The edge functions and the database cron jobs both authenticate with the project's
secret key (`sb_secret_…`):

- **Edge functions** (`make`, `send-messages`, `reconcile-twilio-status`,
  `handle-failed-deliveries`, `archive-double-failures`) check the incoming `apikey`
  header against the project's secret keys, which Supabase injects automatically — a
  new key works the moment it exists, nothing to change here.
- **Postgres cron jobs** call those edge functions via `net.http_post` and send the key
  in the `apikey` header. The standing named jobs run SQL functions that read it from the
  Vault secret named **`secret_key`**, so that is the first thing to update on rotation.
  Otherwise those cron calls return 401.
- **Some jobs hold a copy of the key instead.** Jobs created at runtime (the
  `send-first-messages` and `send-second-messages` workers and the per-minute workers that
  the daily reconciliation, failed-delivery and archive jobs start) copy the key into
  `cron.job.command` when they are scheduled; see the migrations that call `cron.schedule`.
  Some unnamed standing jobs may also contain an `sb_secret_` key (as of 2026-10-09, three
  were seen in production). Updating Vault does not change any of these. List them without
  printing the key:
  ```sql
  select jobid, jobname, command like '%sb_secret_%' as embeds_key
  from cron.job
  order by jobid;
  ```
  Rotate while no broadcast is running, and unschedule and recreate every job that shows
  `embeds_key = true` with the new key before you revoke the old one.

## Steps

1. **Create a new secret key** —
   `https://supabase.com/dashboard/project/<PROJECT_REF>/settings/api-keys`
   Create a new `sb_secret_…` key and copy it.

2. **Update the Vault secret** —
   `https://supabase.com/dashboard/project/<PROJECT_REF>/integrations/vault/secrets`
   Edit `secret_key` and paste the new value.

3. **Recreate every cron job that holds a copy of the key.** Run the query above. For each
   job with `embeds_key = true`, unschedule it and schedule it again with the new key. Jobs
   that the database creates later use the new key. A job that is already running keeps the old
   key until you recreate it.

After cron calls are confirmed working, revoke the old key in the API keys settings.

## Local development and CI

Local and CI never use the production key. The local secret is **pinned** to
`sb_secret_a_secret` in `supabase/config.toml` (`[auth] secret_key`); the Supabase
runtime injects it as `SUPABASE_SECRET_KEYS` for every edge function, so it is what
the incoming `apikey` is checked against. Two other files must carry that same value,
or local cron POSTs 401 the same way production would:

- **root `.env` → `SECRET_KEY`** — `deno task dev` seeds this into the Vault
  `secret_key` via `add_keys_to_vault.sh`; it is the value the cron jobs send, so it
  must equal the `config.toml` pin. `.env-example` defaults to it.
- **`supabase/functions/tests/.env.edge_testing` → `SUPABASE_SECRET_KEYS.default`** —
  the standalone edge runtime started by `deno task test:setup`.

(`supabase/functions/.env` also lists `SUPABASE_SECRET_KEYS`, but `supabase start`
strips it and re-injects the `config.toml` pin, so its value is ignored locally.)
