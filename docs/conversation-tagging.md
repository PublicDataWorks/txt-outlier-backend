# AI Conversation Tagging

This document describes the AI conversation tagging system: how finished SMS conversations with Detroit residents are
automatically tagged and summarized by Claude, reviewed by the team in Slack, and rolled up into a weekly digest and
dashboard.

## Overview

The pipeline runs in five stages:

1. **Close**: A conversation accumulates inbound/outbound Twilio messages. There is no explicit "close" event — the
   `analyze-conversations` cron job simply looks for conversations that don't have an analysis row yet each time it
   runs, so a conversation becomes eligible for analysis as soon as it exists and has at least one inbound message.
2. **Queue**: Rows are inserted into `conversation_analyses` with `status = 'pending'`, either continuously (see
   below — realtime seeding happens as part of normal conversation processing) or in bulk via the
   `seed-backfill` action for historical data.
3. **Cron**: The `analyze-conversations` cron job calls the `conversation-analysis` edge function every minute with
   `action: 'process-queue'`, which claims a small batch of pending rows and processes them one at a time.
4. **AI**: For each claimed row, the transcript is pulled from `twilio_messages`, sent to Claude with the active tag
   taxonomy, and a structured result (tag, secondary tags, summary, supporting quote, unmet-demand flag) comes back.
5. **Slack review / promote**: The result is posted to the configured Slack channel with a "Promote to story idea"
   button. Editors review it there; clicking the button marks the analysis as promoted and updates the Slack message
   in place.

On top of the realtime pipeline, a **weekly digest** summarizes the last 7 days to Slack, and an **insights
dashboard** exposes the same data (tags over time, unmet demand, promoted count) as a web page.

## Database Schema

Added in `supabase/migrations/20260712090000_add_conversation_analysis.sql`.

### `conversation_analyses`

One row per conversation that has been queued for analysis (unique on `conversation_id`).

| Column                | Notes                                                                             |
|------------------------|------------------------------------------------------------------------------------|
| `status`              | `pending` → `processing` → `completed` / `failed` / `skipped`                     |
| `source`              | `realtime` or `backfill` — realtime rows are always processed first               |
| `attempts`            | Incremented each time the row is claimed; after 3 failed attempts it stays `failed` instead of going back to `pending` |
| `tag` / `secondary_tags` | Primary tag (always one of the active `analysis_tags`, or `other`) and up to 2 secondary tags |
| `summary`             | 2-3 sentence neutral summary                                                      |
| `supporting_quote`    | Verbatim quote from an inbound (resident) message                                 |
| `unmet_demand` / `unmet_demand_reason` | Set when the resident asked for something the service couldn't provide or never answered |
| `confidence`          | Model's confidence in the analysis, 0-1                                           |
| `model` / `prompt_version` | Recorded per row so we can compare quality across model/prompt changes       |
| `slack_channel` / `slack_message_ts` | Identify the posted Slack message so it can be updated later (e.g. on promotion) |
| `promoted_at` / `promoted_by` | Set when someone clicks "Promote to story idea" in Slack                    |

Indexes: `status`, `tag`, `created_at`, and a partial index on `unmet_demand` (`WHERE unmet_demand`) for the
dashboard's unmet-demand queries.

### `analysis_tags`

The editable tag taxonomy used both to prompt Claude and to validate its primary tag choice. Seeded by the migration
with a starter taxonomy for Outlier Media's Detroit SMS service — see [Tag Taxonomy](#tag-taxonomy) below.

## Edge Functions

### `conversation-analysis`

`POST`, `verify_jwt = false`, invoked with the same secret-key auth pattern as other cron-invoked functions
(`{ auth: 'secret' }`).

- **`{ "action": "process-queue", "batchSize"?: number }`** (default `batchSize` 5) — claims up to `batchSize`
  pending rows (`FOR UPDATE SKIP LOCKED`, realtime before backfill, oldest first), marking each `processing` and
  incrementing `attempts`. For each claimed row:
  - If the transcript is empty or has no inbound message, the row is marked `skipped` and nothing is posted to
    Slack.
  - Otherwise the transcript is analyzed, the result is posted to Slack, and the row is marked `completed`.
  - On error, the row goes back to `pending` (to retry on the next cron tick) unless `attempts >= 3`, in which case
    it's marked `failed`.
  - Called every minute by the `analyze-conversations` cron job (see [Backfill](#running-a-historical-backfill)
    below for how this drains a large backlog).
- **`{ "action": "seed-backfill", "limit"?: number, "before"?: string, "after"?: string }`** — inserts `pending`
  rows with `source = 'backfill'` for every conversation that has at least one inbound Twilio message (a message
  addressed to the Outlier number), optionally bounded by `conversations.created_at` (`before`/`after` are ISO
  date strings). Existing rows are left alone (`ON CONFLICT (conversation_id) DO NOTHING`). Returns
  `{ "seeded": number }`.

### `slack-interactions`

`POST`, `verify_jwt = false`. Slack's interactivity request URL for this app. Verifies the request signature
(`x-slack-request-timestamp` + `x-slack-signature` against the raw body, rejecting anything more than 5 minutes
old), then handles `block_actions` payloads for the `promote_story_idea` action: sets `promoted_at` / `promoted_by`
on the corresponding `conversation_analyses` row (a no-op if it's already promoted, so a duplicate click or Slack
retry is harmless) and updates the Slack message in place — the button is replaced with a
":star: Promoted to story idea by \<name\>" context line. Always responds `200` quickly, per Slack's requirements.

### `weekly-digest`

`POST`, `verify_jwt = false`, invoked by the `weekly-conversation-digest` cron job **every Monday at 14:00 UTC**.
Aggregates `completed` analyses from the last 7 days: total conversations analyzed, top tags with counts and the
delta vs. the prior 7 days, unmet-demand count with up to 3 example summaries (linked to Missive), and how many
analyses were promoted to story ideas this week. Posts the result as a Slack Block Kit message to
`SLACK_ANALYSIS_CHANNEL_ID`. If nothing was analyzed in the window, it posts a short "quiet week" message instead.

### `insights-dashboard`

`GET`, `verify_jwt = false`. A small Hono app serving an internal dashboard:

- `GET /insights-dashboard` — self-contained HTML page (stat tiles, a stacked weekly tags-over-time chart, and an
  unmet-demand table).
- `GET /insights-dashboard/data/summary` — `{ total, last7Days, unmetDemandLast30Days, promotedTotal, topTags }`.
- `GET /insights-dashboard/data/tags-over-time?weeks=12` — `[{ week, tag, count }]`, one row per tag per ISO week.
- `GET /insights-dashboard/data/unmet-demand?limit=50` — recent unmet-demand rows (summary, reason, tag,
  `created_at`, Missive link).

If `DASHBOARD_TOKEN` is set, every request (including the HTML page) must include a matching `?token=` query
parameter or it returns `401`. See [Dashboard](#dashboard) below.

## Environment Variables

| Variable                    | Required | Purpose                                                                 |
|------------------------------|----------|--------------------------------------------------------------------------|
| `ANTHROPIC_API_KEY`          | Yes      | Claude API key used to analyze transcripts.                              |
| `ANALYSIS_MODEL`             | No       | Model id to use for analysis. Defaults to `claude-sonnet-5`.              |
| `SLACK_BOT_TOKEN`            | Yes      | Bot token used for `chat.postMessage`, `chat.update`, `conversations.history`. |
| `SLACK_ANALYSIS_CHANNEL_ID`  | Yes      | Channel (or channel ID) the analysis messages and weekly digest are posted to. |
| `SLACK_SIGNING_SECRET`       | Yes      | Used to verify requests hitting `slack-interactions` actually came from Slack. |
| `DASHBOARD_TOKEN`            | No       | If set, required as `?token=` on every `insights-dashboard` request.      |
| `DASHBOARD_URL`              | No       | Public URL of the dashboard; when set, it's linked from the weekly digest message. |

Add these to `supabase/functions/.env` (and `.env-example` as blank placeholders) alongside the existing secrets —
see [Environment Files](environment-files.md) for how the different env files are used and deployed.

### Slack app setup

1. Create a Slack app (or reuse an existing internal one) at https://api.slack.com/apps.
2. Under **OAuth & Permissions**, add the `chat:write` bot token scope, then install the app to the workspace and
   copy the **Bot User OAuth Token** into `SLACK_BOT_TOKEN`.
3. Invite the bot to the channel that will receive analysis posts and the weekly digest, then copy that channel's ID
   into `SLACK_ANALYSIS_CHANNEL_ID`.
4. Under **Basic Information**, copy the **Signing Secret** into `SLACK_SIGNING_SECRET`.
5. Under **Interactivity & Shortcuts**, turn interactivity on and set the **Request URL** to the deployed
   `slack-interactions` function's URL (e.g. `https://<project-ref>.functions.supabase.co/slack-interactions`).
   Slack will send a one-time verification request to this URL when you save it, which the function should answer
   with `200` like any other request.
6. Reinstall the app if Slack prompts you to after adding scopes.

## Running a Historical Backfill

Backfilling doesn't process conversations directly — it only seeds `conversation_analyses` rows with
`source = 'backfill'`, which the existing `analyze-conversations` cron job then drains at the same pace as realtime
traffic (`batchSize` 5 per minute, realtime rows always prioritized ahead of backfill ones).

Seed the queue with a `curl` call to `conversation-analysis` (using whatever secret-key auth header the environment
expects — see [Environment Files](environment-files.md)):

```bash
curl -X POST "$EDGE_FUNCTION_URL/conversation-analysis" \
  -H "Content-Type: application/json" \
  -H "apikey: $SECRET_KEY" \
  -d '{
    "action": "seed-backfill",
    "limit": 5000,
    "after": "2025-01-01T00:00:00Z",
    "before": "2026-01-01T00:00:00Z"
  }'
```

`limit`, `before`, and `after` are all optional — omit them to seed every conversation with at least one inbound
message that doesn't already have an analysis row. The response is `{ "seeded": <number of rows inserted> }`;
running the same call again is safe, since existing rows are left untouched (`ON CONFLICT DO NOTHING`).

At 5 rows/minute, a backlog of N conversations takes roughly N / 5 minutes to fully drain — for example, 5,000
seeded conversations take about 17 hours. To go faster temporarily, call `conversation-analysis` directly with a
larger `batchSize` (e.g. `{ "action": "process-queue", "batchSize": 50 }`), keeping in mind this increases Claude
and Slack API usage proportionally.

## Weekly Digest

The `weekly-conversation-digest` cron job runs **every Monday at 14:00 UTC** and calls the `weekly-digest` edge
function, which posts a summary of the previous 7 days to `SLACK_ANALYSIS_CHANNEL_ID` (see
[Edge Functions](#weekly-digest) above for what it includes).

## Dashboard

The dashboard at `GET /insights-dashboard` is meant for internal use — it has no login of its own. If
`DASHBOARD_TOKEN` is set in the environment, share the URL with the token appended, e.g.:

```
https://<project-ref>.functions.supabase.co/insights-dashboard?token=<DASHBOARD_TOKEN>
```

Without a token configured, the dashboard (and its `/data/*` JSON endpoints) are open to anyone with the URL, so
setting `DASHBOARD_TOKEN` is strongly recommended outside of local development. Set `DASHBOARD_URL` so the weekly
digest message can link straight to it.

## Tag Taxonomy

The taxonomy lives in the `analysis_tags` table and is loaded fresh on every analysis run — no redeploy needed to
change it. It's seeded by the migration with:

| Tag                | Description                                                                          |
|---------------------|----------------------------------------------------------------------------------------|
| `housing`           | Housing conditions, evictions, landlord disputes, home repair, or housing assistance   |
| `utilities`         | Water, gas, electric, internet, or other utility service issues and shutoffs           |
| `employment`        | Job search, unemployment benefits, workplace issues, or job training                   |
| `food-assistance`   | SNAP benefits, food banks, school meals, or other food assistance needs                |
| `transportation`    | Public transit, DDOT/SMART bus routes, road conditions, or car-related needs           |
| `health`            | Physical or mental health care access, insurance coverage, or public health concerns    |
| `public-safety`     | Crime, policing, violence, or neighborhood safety concerns                             |
| `education`         | Schools, enrollment, childcare, or other educational resources                         |
| `legal-aid`         | Legal questions, court issues, tenant rights, or need for legal representation          |
| `civic-info`        | Elections, voting, city services, government programs, or civic participation          |
| `story-tip`         | A tip or lead for a potential Outlier Media news story                                 |
| `service-feedback`  | Feedback, praise, or complaints about the Outlier Media SMS service itself             |
| `other`             | Does not fit any other category in the taxonomy                                        |

To edit the taxonomy:

- **Add a tag**: `INSERT INTO analysis_tags (name, description) VALUES ('new-tag', 'What this tag means');`
- **Retire a tag** (without breaking historical rows that already reference it):
  `UPDATE analysis_tags SET active = false WHERE name = 'old-tag';`. Only `active = true` tags are offered to Claude
  as choices, but past `conversation_analyses.tag` values referencing a retired tag are untouched.
- **Reactivate a tag**: `UPDATE analysis_tags SET active = true WHERE name = 'old-tag';`
- **Edit a description**: `UPDATE analysis_tags SET description = '...' WHERE name = 'housing';` — this changes how
  the tag is explained to Claude on the next analysis run, with no code change required.

Whatever primary tag Claude returns is matched case-insensitively against the active taxonomy; if it doesn't match
any active tag, the row is stored with `tag = 'other'` and Claude's original (unmatched) tag is kept as a secondary
tag instead, so nothing is silently dropped.
