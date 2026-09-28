# Application secrets

Two different mechanisms hold secrets in this project, and they are not interchangeable:

- **Vault (`vault.decrypted_secrets`)** — for secrets that *Postgres itself* needs. The cron jobs
  call edge functions through `net.http_post` and read `secret_key` and the edge function URL from
  Vault, because a cron job has no environment. See [key-rotation.md](key-rotation.md).
- **Edge function environment variables** — for secrets that *application code* needs. Every
  Missive, Twilio, OpenAI and Dub credential is read with `Deno.env.get(...)` (see
  `supabase/functions/_shared/lib/Missive.ts`). The Python lookups service does the same with
  `os.environ`.

**Credentials must never be stored in an ordinary data table.** `public.lookup_template` is
configuration — SMS templates, LLM prompts, model names, label ids — and is readable by anything
with broad read access to the `public` schema.

## Why this rule exists

`lookup_template` held the live Missive API token as row `name='missive_secret'`, alongside 35 rows
of harmless template text. Consequences:

- Any role with `SELECT` on the `public` schema could read it. Three analyst read-only roles
  (`readonly_outlier`, `readonly_kate`, `address-lookup-readonly`) could, until access to the table
  was revoked on 2026-09-27 (migration `20260928064500`).
- The value contains no `token`/`secret`/`key` substring, so a content keyword scan does **not**
  find it. Only the row's `name` reveals what it is.
- `txt-outlier-lookups` stopped reading it in PR #82 (merged 2025-10-27) in favour of the
  `MISSIVE_SECRET` environment variable, so the row was orphaned for ~11 months while still holding
  a live credential.
- The value is present in every database backup taken during that period.

## One-time remediation

Migration `20260928075945_remove_missive_token_from_lookup_template.sql` deletes the row and
removes `anon`/`authenticated` grants on the table. **Deleting the row is not sufficient on its
own** — the token is in existing backups and was readable by analyst credentials, so it must be
treated as exposed and rotated.

1. **Confirm nothing reads the row.** It should be zero across every service:
   ```
   grep -rn "missive_secret" <each txt-outlier repo> --exclude-dir=node_modules
   ```
   As of 2026-09-28 the only hit is `txt-outlier-import`, which looks up
   `missive_secret_for_webhook_service` — a row that does not exist in the database. That code path
   has therefore been receiving an empty token; fix or delete it separately, and do **not**
   "fix" it by adding the row back.

2. **Apply the migration** — `supabase db push`, or run the file directly. Safe at any time; no
   consumer reads the row.

3. **Rotate the Missive token.** Generate a new API token in Missive
   (Settings → API), then update every place the old one lives:
   - 1Password → Outlier vault → `txt-outlier-lookups` → `MISSIVE_SECRET`
     (note: that item currently has **two** fields labelled `MISSIVE_SECRET` with different
     values — the 82-character one is the live token. Delete the stale one while you are there.)
   - The deployed lookups service environment.
   - Any other service reading `MISSIVE_SECRET`.

4. **Verify** the lookups service can still call Missive, then revoke the old token in Missive.

## Standing checks

`lookup_template` is still legitimately used for configuration, so it cannot simply be locked down.
When rotating keys or reviewing access, check that no new credential has been added to it:

```sql
-- rows whose name suggests a credential
select id, name, type, length(content) as len
from public.lookup_template
where name ~* '(secret|token|key|password|credential|auth)'
order by id;
```

Two rows match on substrings and are benign — `keyword_label_parent_id` ("key") and `max_tokens`
("token"). After the remediation above those two are the expected baseline; **anything else is a
finding.** Judge by the row's purpose, not by whether the content looks random: the Missive token
was an unremarkable 82-character string in a column that otherwise holds prose.

If a credential appears, move the value to an environment variable and delete the row — do not
rely on the row name being hard to guess.

Note that analyst roles cannot read this table at all, so this query must be run as the table owner
or `service_role`.
