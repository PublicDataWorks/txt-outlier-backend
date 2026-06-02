# Rotating the secret key

The edge functions and the database cron jobs both authenticate with the project's
secret key (`sb_secret_…`):

- **Edge functions** (`make`, `send-messages`, `reconcile-twilio-status`,
  `handle-failed-deliveries`, `archive-double-failures`) check the incoming `apikey`
  header against the project's secret keys, which Supabase injects automatically — a
  new key works the moment it exists, nothing to change here.
- **Postgres cron jobs** call those edge functions via `net.http_post` and send the key
  in the `apikey` header. They read it from the Vault secret named **`secret_key`**, so
  this is the one you must update on rotation — otherwise every cron call returns 401.

## Steps

1. **Create a new secret key** —
   `https://supabase.com/dashboard/project/<PROJECT_REF>/settings/api-keys`
   Create a new `sb_secret_…` key and copy it.

2. **Update the Vault secret** —
   `https://supabase.com/dashboard/project/<PROJECT_REF>/integrations/vault/secrets`
   Edit `secret_key` and paste the new value.

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
