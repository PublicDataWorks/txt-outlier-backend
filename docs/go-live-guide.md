# Conversation Tagging Go-Live Guide

The step-by-step runbook for taking the AI conversation tagging pipeline (PR #103) from merged code to live Slack posts. Follow the steps in order; each one lists how to verify it worked before moving on. Deep-dive reference for every design decision lives in [conversation-tagging.md](conversation-tagging.md).

**What you are turning on.** When a Missive SMS conversation closes, a queue row is created with a 72-hour delay. A cron drains the queue every minute: it builds the transcript, calls the OpenAI Responses API (`gpt-5.6-sol` realtime / `gpt-5.6-terra` backfill) for a structured impact tag, topic, summary, and verbatim quote, applies suppression rules, and posts a Block Kit message to a Slack channel with a "Promote to story idea" button. A weekly digest posts Mondays at 14:00 UTC, and a token-gated dashboard shows tags over time and unmet demand.

---

## Pre-flight checklist

Everything you need in hand before starting:

- [ ] An OpenAI API key with access to the `gpt-5.6` family
- [ ] Admin access to the Outlier Slack workspace (to create an app)
- [ ] Supabase project access (`pshrrdazlftosdtoevpf`): secrets, SQL editor, function deploys
- [ ] The Slack channel the team will review analyses in (create it now if it doesn't exist)
- [ ] PR #103 approved and ready to merge

---

## Step 1 - Create the Slack app

> To hand this step to a browser or computer-use agent instead of doing it yourself, give it
> [`docs/slack-setup-agent-instructions.md`](./slack-setup-agent-instructions.md). It covers the same
> ground click by click and reports back the three values Step 2 needs.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → *From scratch* → name it (e.g. `Conversation Insights`), pick the Outlier workspace.
2. **OAuth & Permissions → Bot Token Scopes** - add exactly these two:
   - `chat:write` (post and update analysis messages)
   - `channels:history` (read a message back before rewriting it on promotion or retry)
3. **Install App** to the workspace. Copy the **Bot User OAuth Token** (`xoxb-…`) - this is `SLACK_BOT_TOKEN`.
4. **Basic Information → App Credentials** - copy the **Signing Secret**. This is `SLACK_SIGNING_SECRET`.
5. In Slack, open the review channel → invite the bot: `/invite @Conversation Insights`. Then copy the **channel ID** (channel name → View channel details → bottom of the About tab, starts with `C`). This is `SLACK_ANALYSIS_CHANNEL_ID`.
6. **Interactivity & Shortcuts** → toggle on → set the Request URL to:

   ```
   https://pshrrdazlftosdtoevpf.supabase.co/functions/v1/slack-interactions
   ```

   Slack verifies this URL with a challenge only after the function is deployed; if it rejects the URL now, finish Step 3 and come back.

**Verify:** the bot appears as a member of the channel.

## Step 2 - Set the edge function secrets

Set these on the Supabase project (Dashboard → Edge Functions → Secrets, or `supabase secrets set KEY=value`):

| Variable | Required | Value |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Your OpenAI key |
| `OUTLIER_PHONE_NUMBER` | Yes | **`67485`** - see warning below |
| `SLACK_BOT_TOKEN` | Yes | `xoxb-…` from Step 1 |
| `SLACK_SIGNING_SECRET` | Yes | Signing secret from Step 1 |
| `SLACK_ANALYSIS_CHANNEL_ID` | Yes | `C…` channel ID from Step 1 |
| `DASHBOARD_TOKEN` | Yes | A long random string - `openssl rand -hex 24`. The dashboard rejects every request without it |
| `DASHBOARD_URL` | No | Full dashboard URL incl. token; when set, the weekly digest links to it |
| `ANALYSIS_MODEL` | No | Defaults to `gpt-5.6-sol` (realtime) |
| `ANALYSIS_BACKFILL_MODEL` | No | Defaults to `gpt-5.6-terra` (backfill) |
| `ANALYSIS_REASONING_EFFORT` | No | Defaults to `medium` |

> **The one value that can silently ruin everything:** `OUTLIER_PHONE_NUMBER` must match `twilio_messages.from_field`/`to_field` **exactly**, and in production that is the short code `67485`, not an E.164 number like `+13135550100`. Set to anything else, the short code stops being filtered out of the "resident" list, and every transcript becomes the merged history of ~595,000 conversations - with no error anywhere, just nonsensical summaries. Verify against the data, not from memory:
>
> ```sql
> SELECT from_field, count(*) FROM twilio_messages GROUP BY 1 ORDER BY 2 DESC LIMIT 1;
> -- Expect: 67485
> ```

Leaving the optional variables **unset or blank is safe** - empty values fall back to the defaults.

## Step 3 - Merge and deploy

1. Merge PR #103.
2. Apply the two migrations (via the normal deploy pipeline, or `supabase db push`):
   - `20260712090000_add_conversation_analysis.sql` - tables, RLS, cron jobs, RPC lockdown
   - `20260712170000_conversation_analysis_q2_taxonomy.sql` - the 10-tag taxonomy, delay + suppression columns
3. Deploy the functions (new: `conversation-analysis`, `slack-interactions`, `weekly-digest`, `insights-dashboard`; changed: `user-actions` and shared code):

   ```bash
   supabase functions deploy conversation-analysis slack-interactions weekly-digest insights-dashboard user-actions
   ```

4. The cron trigger functions read two Vault secrets that should already exist from prior cron setups - verify:

   ```sql
   SELECT name FROM vault.decrypted_secrets WHERE name IN ('secret_key', 'edge_function_url');
   -- Expect both rows. If missing, run supabase/migrations/protected_migrations/add_keys_to_vault.sh
   ```

**Verify:** the migration started two cron jobs. The queue is empty so they tick harmlessly, but confirm they exist:

```sql
SELECT jobname, schedule FROM cron.job
WHERE jobname IN ('analyze-conversations', 'weekly-conversation-digest');
-- analyze-conversations        * * * * *
-- weekly-conversation-digest   0 14 * * 1
```

Then go back to Step 1.6 and confirm Slack accepts the interactivity URL.

## Step 4 - Smoke test with one real conversation

This is the first time the OpenAI call touches real resident data, so watch one conversation all the way through before anything runs in bulk.

1. **Seed exactly one row** (a recent closed conversation, so the summary is easy to sanity-check):

   ```bash
   curl -X POST "https://pshrrdazlftosdtoevpf.supabase.co/functions/v1/conversation-analysis" \
     -H "Content-Type: application/json" \
     -H "apikey: $SECRET_KEY" \
     -d '{"action": "seed-backfill", "limit": 1, "after": "2026-07-01T00:00:00Z"}'
   # Expect: {"seeded": 1}
   ```

   (`$SECRET_KEY` is the same secret-key auth the other cron-invoked functions use - see [environment-files.md](environment-files.md).)

2. **Wait up to a minute** - the cron claims it on the next tick. Backfill rows have no 72-hour delay.

3. **Check the row:**

   ```sql
   SELECT status, tag, topic, confidence, suppress_reason, error, slack_message_ts
   FROM conversation_analyses ORDER BY id DESC LIMIT 1;
   ```

   - `completed` with `suppress_reason IS NULL` → a Slack post should be in the channel.
   - `completed` with `suppress_reason` set → correctly analyzed but filtered (e.g. `tag:no-impact`, `low-confidence`). Normal; seed one more and check again.
   - `failed` / `error` set → see [Troubleshooting](#troubleshooting).

4. **Review the Slack post like an editor would:** tag and summary plausible? Quote actually verbatim from the resident? **No phone number, address, or name anywhere?**

5. **Click "Promote to story idea."** The message should update in place within a few seconds (button gone, ":star: Promoted by …" note added), and `promoted_at`/`promoted_by` should be set on the row. This proves the signing secret and interactivity URL.

6. **Open the dashboard:**

   ```
   https://pshrrdazlftosdtoevpf.supabase.co/functions/v1/insights-dashboard/?token=<DASHBOARD_TOKEN>
   ```

   Tiles, chart, and the unmet-demand table should render (mostly zeros at this point).

**Realtime is now live too:** every Missive conversation that closes from here on is queued automatically and posts ~72 hours later (suppression rules permitting).

## Step 5 - Run the historical backfill

Once the smoke test looks right, drain history in bounded batches rather than all at once:

```bash
curl -X POST "https://pshrrdazlftosdtoevpf.supabase.co/functions/v1/conversation-analysis" \
  -H "Content-Type: application/json" \
  -H "apikey: $SECRET_KEY" \
  -d '{"action": "seed-backfill", "limit": 500, "after": "2025-01-01T00:00:00Z"}'
```

- Seeding is idempotent - conversations that already have a row are skipped, so re-running the same call is safe, and each run picks up where the last left off.
- The cron drains 5 rows/minute (~7,200/day), realtime rows always first, so the backfill never starves live conversations.
- **Scale expectation:** roughly 4,000 eligible conversations ≈ **$50–60 on Terra** (double on Sol). Check spend on the OpenAI usage dashboard after the first 500.
- Backfill results are recorded for analytics and **do post to Slack** when unsuppressed - most historical rows land on suppressed tags, but expect some channel volume. If that's too noisy, seed in small batches during work hours so the team can watch.
- Progress check:

  ```sql
  SELECT status, count(*) FROM conversation_analyses GROUP BY status;
  SELECT suppress_reason, count(*) FROM conversation_analyses
  WHERE suppress_reason IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
  ```

## Step 6 - Ongoing operation

**Weekly digest** posts Mondays 14:00 UTC. It counts realtime analyses completed in the week (backfill is excluded by design, so history never floods a digest) plus promotions of any source. If a Monday run fails (5xx in logs / Sentry), re-invoking the function **before the next Monday 14:00 UTC** reproduces exactly the missed digest:

```bash
curl -X POST "https://pshrrdazlftosdtoevpf.supabase.co/functions/v1/weekly-digest" \
  -H "apikey: $SECRET_KEY" -d '{}'
```

**Editing the taxonomy** needs no redeploy: `UPDATE analysis_tags SET active = false WHERE name = '…'` (or insert new rows). The prompt, the schema enum, and the priority guidance all rebuild from active tags on every run. Never deactivate all tags - the queue pauses (by design) until at least one is active.

**Tuning suppression:** the dashboard's "Suppressed (30d)" tile and the digest's suppressed stat show the filtered volume. The tag list (`SUPPRESS_TAGS`) and confidence floor (`0.5`) are constants in `AnalysisService.ts` - changing those does need a deploy.

**Watching for failures:**

```sql
SELECT id, conversation_id, attempts, error, updated_at
FROM conversation_analyses WHERE status = 'failed' ORDER BY updated_at DESC;
```

Failed rows are never retried automatically (3 attempts with 5/30-minute backoff, then final). To retry after fixing the cause:

```sql
UPDATE conversation_analyses SET status = 'pending', attempts = 0, process_after = NOW()
WHERE status = 'failed';
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Row `failed`, error mentions `OPENAI_API_KEY` or 401 | Key unset/invalid | Set the secret, redeploy nothing needed; reset the row to `pending` |
| Error mentions `model` / 404 | Key lacks `gpt-5.6` access, or a typo in `ANALYSIS_MODEL` | Fix the secret; unset means correct defaults |
| Summaries are nonsense, transcripts absurdly long | `OUTLIER_PHONE_NUMBER` is not `67485` | Fix it, then delete + reseed affected rows |
| Row `completed` but no Slack post, `suppress_reason` set | Working as designed | See suppression rules in conversation-tagging.md |
| Slack post but error mentions `channel_not_found` / `not_in_channel` | Wrong channel ID or bot not invited | Recheck Step 1.5 |
| Promote click shows a Slack error | Interactivity URL or `SLACK_SIGNING_SECRET` mismatch | Recheck Steps 1.4, 1.6; the DB write may still have landed - check `promoted_at` |
| Rows stuck `skipped` with `ambiguous-transcript` | Resident phone spans several conversations (28 known cases) | Expected; these are deliberately not analyzed |
| Rows stuck `pending`, cron running | All tags inactive, or `process_after` in the future | Reactivate a tag; realtime rows wait 72h by design |
| Dashboard shows 401 | Missing/wrong `?token=` | Match `DASHBOARD_TOKEN` exactly |

## Known limitations (accepted, documented)

- **Duplicate Slack post, narrow window:** if the post succeeds but the immediately-following DB write fails, a retry posts again. Slack offers no idempotency key; accepted for now.
- **A failed enqueue is recovered by backfill, not retried:** if the close-webhook enqueue hits a transient DB error, run `seed-backfill` (it selects exactly the missed conversations).
- **Name redaction grows over time:** 99.7% of historical `authors` rows have no name recorded, so name redaction rests on the prompt until names fill in through new ingests. Phones, addresses, ZIPs, and account numbers are always redacted in code.
- **Transcript attribution:** messages carry no conversation ID; residents on multiple conversations (0.03%) are skipped rather than misattributed. Proper fix is recording the conversation on each message at ingest.
