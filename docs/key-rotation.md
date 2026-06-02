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

> Local and CI are unaffected — they use a pinned placeholder
> (`[auth] secret_key = "sb_secret_a_secret"` in `supabase/config.toml`), not the
> production key.
