# AI Conversation Tagging

This document describes the AI conversation tagging system: how finished SMS conversations with Detroit residents are
automatically tagged and summarized by an OpenAI model, reviewed by the team in Slack, and rolled up into a weekly
dashboard.

## Overview

The pipeline runs in six stages:

1. **Close**: A conversation accumulates inbound/outbound Twilio messages. When Missive fires a `conversation_closed`
   event, the `user-actions` webhook enqueues a `pending` `conversation_analyses` row for it with
   `process_after = now + 72 hours` — see [The 3-Day Delay](#the-3-day-delay-and-reopen-handling) below for why.
2. **Queue**: Rows are inserted into `conversation_analyses` with `status = 'pending'`, either continuously (via the
   `user-actions` webhook on `conversation_closed`, as above) or in bulk via the `seed-backfill` action for
   historical data (which skips the delay — `process_after` defaults to now). The `analyze-conversations` cron job
   only drains this queue — it doesn't decide what gets queued.
3. **Cron**: The `analyze-conversations` cron job calls the `conversation-analysis` edge function every minute with
   `action: 'process-queue'`, which claims a small batch of pending rows whose `process_after` has elapsed and
   processes them one at a time.
4. **AI**: For each claimed row, the transcript is pulled fresh from `twilio_messages` (capturing any activity since
   the conversation closed, not a stale close-time snapshot) and sent to the OpenAI Responses API with the active tag
   taxonomy and topic list. Structured Outputs (`strict: true`, with the taxonomy as an `enum`) guarantees a result
   with a valid impact tag, secondary tags, topic, summary, supporting quote, unmet-demand flag, and confidence.
   The supporting quote is then verified to appear verbatim in an inbound message before it can reach Slack — see
   [Model and Reliability](#model-and-reliability).
5. **Suppression**: Some tags (and low-confidence results) are filtered from Slack — see
   [Suppression Rules](#suppression-rules) below. Everything is still recorded in `conversation_analyses` for
   dashboard/analytics purposes; only the Slack post is skipped.
6. **Slack review / promote**: Non-suppressed results are posted to the configured Slack channel with a "Promote to
   story idea" button, using the [notification template](#notification-template) below. Editors review it there;
   clicking the button marks the analysis as promoted and updates the Slack message in place.

On top of the realtime pipeline, a **weekly digest** summarizes the last 7 days to Slack, and an **insights
dashboard** exposes the same data (tags over time, unmet demand, promoted count) as a web page.

## Database Schema

Added in `supabase/migrations/20260712090000_add_conversation_analysis.sql`, extended in
`supabase/migrations/20260712170000_conversation_analysis_q2_taxonomy.sql` (the evidence-based taxonomy, `topic`,
`process_after`, and `suppress_reason`).

### `conversation_analyses`

One row per conversation that has been queued for analysis (unique on `conversation_id`).

| Column                | Notes                                                                             |
|------------------------|------------------------------------------------------------------------------------|
| `status`              | `pending` → `processing` → `completed` / `failed` / `skipped`                     |
| `source`              | `realtime` or `backfill` — realtime rows are always processed first               |
| `process_after`       | Row isn't claimed until this timestamp; realtime rows get `now + 72h`, backfill rows get `now` |
| `attempts`            | Incremented each time the row is claimed; after 3 failed attempts it stays `failed` instead of going back to `pending` |
| `tag` / `secondary_tags` | Primary impact tag (one of the active `analysis_tags`, falling back to `no-impact` if the model proposes something unrecognized) and up to 2 secondary tags |
| `topic`               | What the resident actually asked about, from a fixed topic list — see [Tag Taxonomy](#tag-taxonomy) |
| `suppress_reason`     | Set (`tag:<name>` or `low-confidence`) when the result was filtered from Slack; `NULL` means it posted normally. Distinct from `error`, which is a processing failure |
| `summary`             | 2-3 sentence neutral summary ("how we helped" in the Slack template)              |
| `supporting_quote`    | Verbatim quote from an inbound (resident) message, never containing a phone number, address, or full name |
| `unmet_demand` / `unmet_demand_reason` | Set when the resident asked for something the service couldn't provide or never answered |
| `confidence`          | Model's confidence in the analysis, 0-1; below 0.5 is suppressed regardless of tag |
| `model` / `prompt_version` | Recorded per row so we can compare quality across model/prompt changes       |
| `slack_channel` / `slack_message_ts` | Identify the posted Slack message so it can be updated later (e.g. on promotion); `NULL` for suppressed rows |
| `promoted_at` / `promoted_by` | Set when someone clicks "Promote to story idea" in Slack                    |

Indexes: `status`, `tag`, `topic`, `created_at`, a partial index on `process_after` (`WHERE status = 'pending'`) for
the queue claim, and a partial index on `unmet_demand` (`WHERE unmet_demand`) for the dashboard's unmet-demand
queries.

### `analysis_tags`

The editable **impact** tag taxonomy used both to prompt the model and to constrain its primary tag choice. Seeded with
the evidence-based taxonomy derived from an audit of 776 hand-coded real conversations — see
[Tag Taxonomy](#tag-taxonomy) below. The **topic** list is a separate, fixed set defined in
`AnalysisService.TOPIC_TAGS` (not DB-backed, since it's a stable classification independent of the editable impact
taxonomy).

## Edge Functions

### `conversation-analysis`

`POST`, `verify_jwt = false`, invoked with the same secret-key auth pattern as other cron-invoked functions
(`{ auth: 'secret' }`).

- **`{ "action": "process-queue", "batchSize"?: number }`** (default `batchSize` 5) — claims up to `batchSize`
  pending rows whose `process_after` has elapsed (`FOR UPDATE SKIP LOCKED`, realtime before backfill, oldest first),
  marking each `processing` and incrementing `attempts`. For each claimed row:
  - If the conversation has since reopened, the row is marked `skipped` (`suppress_reason =
    'reopened-before-processing'`) without analyzing.
  - If the transcript is empty or has no inbound message, the row is marked `skipped` and nothing is posted to
    Slack.
  - Otherwise the transcript is analyzed. If the result is suppressed (see [Suppression Rules](#suppression-rules)),
    the row is marked `completed` with `suppress_reason` set and nothing is posted; otherwise the result is posted
    to Slack and the row is marked `completed`.
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

`DASHBOARD_TOKEN` is required — every request (including the HTML page) must include a matching `?token=` query
parameter or it returns `401`, and requests are rejected outright if `DASHBOARD_TOKEN` isn't set. See
[Dashboard](#dashboard) below.

## Model and Reliability

Analysis calls go to the **OpenAI Responses API** (`POST /v1/responses`) — OpenAI's recommended endpoint for new
work, and the one the GPT-5.6 family's features are built around. `AnalysisService.ts` calls it with plain `fetch`;
there's no SDK dependency.

### Model tiers

The pipeline picks a tier from the row's `source`, so no caller has to think about it:

| `source` | Env var | Default | Rationale |
|-----------|---------|---------|-----------|
| `realtime` | `ANALYSIS_MODEL` | `gpt-5.6-sol` | A handful of conversations close per day, so the cost delta is cents. Every post is team-visible and drives "promote to story idea" calls, so tag quality is what matters. |
| `backfill` | `ANALYSIS_BACKFILL_MODEL` | `gpt-5.6-terra` | Thousands of rows feeding aggregate analysis, where Terra costs half as much and a few points of accuracy wash out. |

Note that the bare `gpt-5.6` alias routes to Sol — the code always names a tier explicitly so an upstream alias
change can't silently move which model runs. `ANALYSIS_REASONING_EFFORT` (default `medium`) maps to
`reasoning.effort`; drop it to `low` for faster/cheaper runs, raise it if the taxonomy's judgment calls start
slipping.

All three of these are read through a helper that treats an empty or whitespace-only value as unset and falls
back to the default. That matters because `.env-example` lists them as bare `KEY=` lines: a copied file would
otherwise resolve to `''`, which is not nullish and would override the default with an empty model ID.

### What makes the output trustworthy

Four layers, in order:

1. **Structured Outputs with `strict: true`.** The request sends a JSON Schema with `additionalProperties: false`
   and every field in `required`. The API guarantees a conforming response — there's no prose-parsing or
   retry-on-malformed-JSON path.
2. **The taxonomy is an `enum`.** Active `analysis_tags` names are injected as the `enum` for `tag` and
   `secondary_tags`, and `TOPIC_TAGS` as the `enum` for `topic`. An off-taxonomy tag is therefore not something
   the model *can* return. (Strict mode rejects some JSON Schema keywords, so the "at most 2 secondary tags" cap
   lives in the prompt and is enforced in code rather than as `maxItems`.)
3. **Verbatim quote verification.** Structured Outputs can guarantee a quote's *shape* but not its *provenance*,
   and the historical audit caught the model citing details absent from the transcript. Every returned
   `supporting_quote` is checked against the inbound messages (whitespace- and case-normalized); one that doesn't
   appear is dropped and logged, so a fabricated quote can never be published in a resident's voice. The Slack
   template already omits the "Quotable" block when the quote is empty.
4. **Defensive re-validation in code.** The response is still parsed with zod and re-matched against the taxonomy,
   so a schema drift or a tag retired mid-flight degrades to `no-impact` / `Other` rather than writing junk.

### Failure modes

- `status: "incomplete"` (the model hit `max_output_tokens`, currently 25,000 — a ceiling covering reasoning plus
  visible output) throws with `incomplete_details` so the row retries on the next tick.
- A `refusal` content part throws with the refusal text rather than being treated as an empty analysis.
- Requests carry a 120s timeout, generous because reasoning models spend time thinking before emitting tokens.
- `store: false` is set on every call — these are residents' private SMS transcripts, so they're kept out of
  OpenAI's server-side response store.

## Environment Variables

| Variable                    | Required | Purpose                                                                 |
|------------------------------|----------|--------------------------------------------------------------------------|
| `OPENAI_API_KEY`             | Yes      | OpenAI API key used to analyze transcripts.                              |
| `OUTLIER_PHONE_NUMBER`       | Yes      | The service's own SMS number. Required to tell inbound from outbound messages — every analysis fails without it. |
| `ANALYSIS_MODEL`             | No       | Model id for realtime (on-close) analysis. Defaults to `gpt-5.6-sol`.     |
| `ANALYSIS_BACKFILL_MODEL`    | No       | Model id for `source = 'backfill'` rows. Defaults to `gpt-5.6-terra`.     |
| `ANALYSIS_REASONING_EFFORT`  | No       | `reasoning.effort` passed to the model. Defaults to `medium`.             |
| `SLACK_BOT_TOKEN`            | Yes      | Bot token used for `chat.postMessage`, `chat.update`, `conversations.history`. |
| `SLACK_ANALYSIS_CHANNEL_ID`  | Yes      | Channel (or channel ID) the analysis messages and weekly digest are posted to. |
| `SLACK_SIGNING_SECRET`       | Yes      | Used to verify requests hitting `slack-interactions` actually came from Slack. |
| `DASHBOARD_TOKEN`            | Yes      | Required as a matching `?token=` on every `insights-dashboard` request — the dashboard denies all requests when this isn't set. |
| `DASHBOARD_URL`              | No       | Public URL of the dashboard; when set, it's linked from the weekly digest message. |

Add these to `supabase/functions/.env` (and `.env-example` as blank placeholders) alongside the existing secrets —
see [Environment Files](environment-files.md) for how the different env files are used and deployed.

### Slack app setup

1. Create a Slack app (or reuse an existing internal one) at https://api.slack.com/apps.
2. Under **OAuth & Permissions**, add the `chat:write` and `channels:history` bot token scopes (`groups:history`
   instead of/in addition to `channels:history` if the channel is private) — `channels:history`/`groups:history` is
   needed because promoting an analysis reads the posted message via `conversations.history` before `chat.update`.
   Then install the app to the workspace and copy the **Bot User OAuth Token** into `SLACK_BOT_TOKEN`.
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
larger `batchSize` (e.g. `{ "action": "process-queue", "batchSize": 50 }`), keeping in mind this increases OpenAI
and Slack API usage proportionally.

## Weekly Digest

The `weekly-conversation-digest` cron job runs **every Monday at 14:00 UTC** and calls the `weekly-digest` edge
function, which posts a summary of the previous 7 days to `SLACK_ANALYSIS_CHANNEL_ID` (see
[Edge Functions](#weekly-digest) above for what it includes).

A week in which nothing completed still posts, and still reports the promotion count: promotions are counted over
their own `promoted_at` window, so editors can promote older analyses during an otherwise quiet week.

**Known limitation — a failed digest is not re-delivered.** The window is a rolling 7 days and the cron fires once
a week, so if a query or the Slack call fails, that week's digest is lost; the next run computes a fresh window.
The function returns a 5xx (rather than swallowing the error as a 200) so the failure is visible to monitoring and
Sentry, but nothing retries it automatically. Adding real retry means a second schedule plus a record of the last
successful post to avoid double-posting — deliberately not built yet.

## Dashboard

The dashboard at `GET /insights-dashboard` is meant for internal use — it has no login of its own. `DASHBOARD_TOKEN`
is required; share the URL with the token appended, e.g.:

```text
https://<project-ref>.functions.supabase.co/insights-dashboard/?token=<DASHBOARD_TOKEN>
```

Without `DASHBOARD_TOKEN` configured, the dashboard (and its `/data/*` JSON endpoints) reject every request. Set
`DASHBOARD_URL` so the weekly digest message can link straight to it.

## Tag Taxonomy

The impact-tag taxonomy lives in the `analysis_tags` table and is loaded fresh on every analysis run — no redeploy
needed to change it. It replaces an earlier generic placeholder taxonomy with one derived from a historical audit:
two independent teams open-coded 776 real conversations by hand, and their findings were reconciled into the 10
tags below, in priority order (use the first one that fits when more than one applies):

| # | Tag | What it means | Digest behavior |
|---|-----|----------------|------------------|
| 1 | `automation-failure` | A system bug independent of resident behavior — messages continuing after a confirmed STOP, duplicate sends, a menu loop the resident couldn't escape | **Posted** — routes to engineering visibility, never suppressed even though it's not a "good news" tag |
| 2 | `noise-test` | Hostile, harassing, gibberish, or apparent test content with no real service value | Suppressed |
| 3 | `wrong-audience` | Message reached someone it was never meant for (wrong number, minor, out-of-area, mismatched targeting) | Suppressed |
| 4 | `unsubscribe` | Resident explicitly opted out (STOP), typically in response to an unsolicited broadcast | Suppressed |
| 5 | `story-tip` | Resident surfaced information a reporter could turn into a story or investigation | Posted |
| 6 | `reporter-engaged` | A named Outlier journalist or staff member gave a real, personalized response — not an automated or templated broadcast reply | Posted |
| 7 | `unmet-demand` | Resident expressed a real, in-scope need the service didn't resolve in-thread | Posted |
| 8 | `info-gap` | A concrete question was answered correctly via automation/keyword menu, no reporter time spent | Posted |
| 9 | `user-sat` | Resident was connected to a program/referral and expressed explicit satisfaction or gratitude | Posted |
| 10 | `no-impact` | Resident received a broadcast/one-off message and took no further action of any kind | Suppressed |

**Why `automation-failure` isn't suppressed**: an earlier draft of this taxonomy suppressed it like the other
"nothing to see here" tags. The historical audit's QA pass found this exact bug being introduced by the classifier —
suppressing it hides a real, recurring engineering defect from the team instead of surfacing it, which defeats the
purpose of flagging it as its own tag in the first place.

To edit the taxonomy:

- **Add a tag**: `INSERT INTO analysis_tags (name, description) VALUES ('new-tag', 'What this tag means');` — also
  add it to `SUPPRESS_TAGS` in `AnalysisService.ts` if it should be filtered from Slack.
- **Retire a tag** (without breaking historical rows that already reference it):
  `UPDATE analysis_tags SET active = false WHERE name = 'old-tag';`. Only `active = true` tags are offered to the
  model as choices, but past `conversation_analyses.tag` values referencing a retired tag are untouched.
- **Reactivate a tag**: `UPDATE analysis_tags SET active = true WHERE name = 'old-tag';`
- **Edit a description**: `UPDATE analysis_tags SET description = '...' WHERE name = 'info-gap';` — this changes how
  the tag is explained to the model on the next analysis run, with no code change required.

The active taxonomy is passed to the model as a JSON Schema `enum`, so the returned primary tag is guaranteed to be
one of them. The response is still matched case-insensitively against the taxonomy as a defensive check; if it somehow
doesn't match
any active tag, the row is stored with `tag = 'no-impact'` (the closest analog to "we don't actually know what
happened"). Secondary tags are likewise filtered to known taxonomy names and capped at 2.

### Topics

Separately from the impact tag, every analysis picks one **topic** from a fixed list (`TOPIC_TAGS` in
`AnalysisService.ts`) describing what the resident actually asked about — Tax Foreclosure/REPAY, Property & Tax-Status
Lookup, Landlord/Rental/Tenant, Home Repair, Elections, Water, Food/Shelter, Story Pitch, DTE/Utility, Land Contract,
Benefits, Service Menu/General Inquiry, Broadcast/Opt-Out/Non-Substantive Content, or Other. The model is instructed
to prioritize the resident's own words over whichever broadcast campaign the thread happens to contain — the audit's
QA pass found the opposite bias (topic tagging skewing toward the most recent campaign) in an earlier prompt draft.

## Suppression Rules

A completed analysis is filtered from Slack (both the realtime post and the weekly digest's "top tags") when:

- **Its tag is in `SUPPRESS_TAGS`**: `unsubscribe`, `wrong-audience`, `noise-test`, `no-impact` (see the table above).
- **Its confidence is below `MIN_CONFIDENCE`** (0.5) — a genuinely ambiguous call, regardless of tag.

Suppressed rows are still written to `conversation_analyses` with `status = 'completed'` and `suppress_reason` set
(`tag:<name>` or `low-confidence`) — nothing about the analysis is lost, it just never reaches Slack. The dashboard
and weekly-digest "suppressed" stat surface the volume so the rules can be tuned over time. This is separate from
the earlier queue-level filters (message count, unsubscribed author, "no impact"/"unsubscribe" Missive labels) that
some designs apply before analysis even runs — this implementation filters after analysis, at the tag/confidence
level, so every closed conversation with resident replies gets analyzed and recorded even if never posted.

## The 3-Day Delay and Reopen Handling

Realtime closes are enqueued with `process_after = now + 72 hours`, so a conversation isn't summarized off a
premature close — a resident who reopens the thread a day later still gets folded into the eventual analysis rather
than producing a stale, incomplete summary. Backfill rows (`seed-backfill`) skip the delay entirely.

- **Reopen before processing**: the `conversation_reopened` webhook cancels any still-`pending` analysis row for
  that conversation (`status = 'skipped'`, `suppress_reason = 'reopened-before-processing'`).
- **Re-close**: enqueueing again resets an existing row to `pending` with a fresh 72-hour timer and clears any prior
  analysis result, unless a queue worker currently has it claimed (`status = 'processing'`) — in which case the
  in-flight job is left to finish.
- **Race at processing time**: because the delay is long, `processRow` re-checks the conversation's live `closed`
  state (not the queue-time snapshot) immediately before analyzing, and always rebuilds the transcript fresh from
  `twilio_messages` — so a reopen that lands in the gap between the cancel-on-reopen webhook and this tick is still
  caught, and any post-close activity is captured in the eventual summary.

## Notification Template

Analysis Slack posts follow a fixed shape (see `buildAnalysisMessageBlocks` in `SlackService.ts`):

```
💡 INFO GAP FILLED — 14th this quarter
Sarah helped a resident with Home Repair

Topic: Home Repair
How we helped: Sarah followed up over several days to explain which
documents the city's application actually requires, so the resident
could finish applying.

Quotable:
> Yes, thank you very much. I completed the application online on
> Sunday and received confirmation. Thank you for following up.

Closed by Sarah  •  18 messages  •  over 6 days  •  closed Jul 9  •  Open in Missive
[Promote to story idea]
```

**Never included, under any circumstance**: the resident's phone number (not even masked — identity lives behind
the "Open in Missive" link only), street address, full name, or any case/account number. The system prompt
instructs the model never to include these even if they appear verbatim in the resident's own message, but a
prompt is not an enforcement mechanism, so every model-authored string (`summary`, `supporting_quote`,
`unmet_demand_reason`) is also redacted in code before it is returned — once, in `analyzeTranscript`, so the DB
row, the Slack post, the digest, and the dashboard all inherit the same guarantee. Two mechanisms:

- **Pattern-based** (`redactPii`): phone numbers, street addresses, Michigan ZIPs (`48xxx`/`49xxx` only, so
  ordinary 5-digit figures like dollar amounts survive), and case/account/meter numbers — both
  keyword-anchored (`DTE account 123456789`, `case #24-001234`, keeping the keyword for context) and bare
  (`24-001234`, or any run of 7+ digits, which is above ZIPs, years, dollar figures, and small counts).
  Patterns are applied in a fixed order so the specific rule wins: keyword-anchored identifiers first, then
  phones, then the generic long-digit rule — which is why a 10-digit number is still labelled
  `[phone redacted]` rather than `[account redacted]`.
- **Name-based** (`redactKnownNames`): names are not recognizable by shape, so instead of guessing at a pattern
  we read `authors.name` for this conversation's residents and redact exactly those strings. Both the full name
  and its individual parts of 3+ characters are matched (the model paraphrases, so "Jane Doe" may surface as just
  "Jane"), longest-first so a full name becomes one `[name redacted]` rather than two adjacent labels. Because
  the targets come from the database rather than a generic name pattern, organizations and places ("Wayne County",
  "Detroit Water") are never touched. A resident whose name is also an ordinary word will over-redact that word
  within their own conversation — accepted deliberately, since a visible `[name redacted]` costs less than
  publishing an identifier. Residents with no `authors.name` on record fall back to prompt-level protection only.

**Tone and length**: the model is asked for a neutral 2-3 sentence summary — short enough to skim, factual rather
than promotional. "Closed by" is best-effort (see the caveat below); message count and duration come from the
database, never from the model. The "Nth this quarter" ordinal counts completed, non-suppressed analyses with the
same tag since the start of the current calendar quarter, including this one.

`automation-failure` posts use a variant wording ("What happened" instead of "How we helped", no reporter
attribution framing) since there's no human-interest narrative for a system bug — see `SlackService.ts`.

**Caveat**: Missive's `conversation_closed` webhook doesn't reliably identify who clicked close — "Closed by" uses
the conversation's assignee(s) at analysis time, which is accurate in the common case (reporters closing their own
threads) but not a hard guarantee.
