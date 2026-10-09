---
name: outlier-texting-data
description: Query the Outlier Media / TXT Outlier Detroit SMS service Supabase database. Use whenever the question involves texting subscribers, SMS conversations, broadcasts, campaigns, delivery rates, unsubscribes, conversation tagging/analysis, Missive labels and assignments, or Detroit property/parcel/rental/tax-foreclosure lookups.
---

# Outlier Texting Data (Supabase)

You have read-only access to the production Postgres database behind **TXT Outlier**, Outlier Media's
Detroit SMS news and service-journalism line. Residents text in or reply to broadcasts; reporters and
editors answer them through Missive. This database is a webhook-synced mirror of Missive plus the
system's own broadcast/campaign machinery.

**Missive is the source of truth for conversation state.** This database is a mirror kept in sync by
webhooks. Bulk actions taken in the Missive UI do not always emit per-conversation webhooks, so label
and assignment state can drift. Treat counts from `conversations_labels` as "close, not exact."

## Ground rules

- **Read-only.** Your role is `readonly_outlier`. Every query must be a `SELECT`. Never attempt
  `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`ALTER` — they will fail, and attempting them is out of scope.
- **This is real resident PII.** Phone numbers, names, verbatim SMS text, and AI-written summaries of
  people's housing, debt, and utility problems. Never paste raw phone numbers or message text into
  anything shared outside Outlier. Aggregate and de-identify by default; quote a specific message only
  when the user explicitly asks about that conversation.
- **Big tables.** `twilio_messages` (2.4M rows) and `message_statuses` (2.3M rows) are large. Always
  filter by a date range and use `LIMIT` while exploring. Never `SELECT *` from these without a filter.
- **Excluding staff.** Outlier staff appear in `users` (25 rows). Resident-facing analysis should not
  count staff as subscribers.

## Orientation: the four data areas

| Area | Core tables | What it answers |
|---|---|---|
| **Audience** | `authors` | Who subscribes, where, who unsubscribed |
| **Messages** | `twilio_messages`, `message_statuses` | What was said, what got delivered |
| **Sending** | `broadcasts`, `campaigns`, `audience_segments` | What we sent, to whom, when |
| **Conversations** | `conversations`, `conversations_labels`, `labels`, `comments`, `conversation_analyses` | How the newsroom triaged and what it learned |

Plus a separate **`address_lookup`** schema with Detroit property data.

---

## 1. Audience — `authors` (724,556 rows)

One row per phone number. This is the subscriber list.

| Column | Notes |
|---|---|
| `phone_number` | **Primary key.** E.164 format (`+1313...`). This is the join key everywhere. |
| `name` | Often NULL — most subscribers never give a name |
| `unsubscribed` | `true` = opted out via STOP. Exclude from reach/audience counts. |
| `zipcode` | Often NULL; the main geographic field available |
| `email` | Rarely populated |
| `exclude` | Manually flagged to never receive sends |
| `added_via_file_upload` | `true` = imported from a CSV, not organically texted in |

`authors_old` is a pre-migration snapshot. **Ignore it** unless doing history archaeology.

## 2. Messages — `twilio_messages` (2,384,390 rows)

Every individual SMS, both directions. **Direction is determined by `is_reply`:**

- `is_reply = true` → **inbound**, a resident texting Outlier (34,624 rows)
- `is_reply = false` → **outbound**, Outlier texting residents (2,349,592 rows)

Outlier's own numbers, which appear as `to_field` on inbound messages: `67485` (the shortcode,
carries ~99% of traffic), `+18336856203`, `+13135138400`.

| Column | Notes |
|---|---|
| `preview` | **The message text.** Named "preview" but holds the body. |
| `from_field` / `to_field` | Phone numbers. On inbound, `from_field` is the resident. |
| `is_reply` | Direction flag — see above |
| `reply_to_broadcast` / `reply_to_campaign` | Which send this was a reply to — the key to per-send response rates |
| `delivered_at`, `created_at` | Use `created_at` for time-series unless you specifically need delivery time |
| `sender_id` | Staff user who sent it, joins `users.id` |
| `attachments` | MMS media |

Data starts **2024-03-25**. `twilio_messages_old` is a pre-migration snapshot — ignore it.

### Delivery outcomes — `message_statuses` (2,331,537 rows)

One row per outbound recipient per send. This is where deliverability lives, **not** in
`twilio_messages`.

`twilio_sent_status` values and current totals:

| Status | Count | Meaning |
|---|---|---|
| `delivered` | 1,571,058 | Confirmed delivered |
| `undelivered` | 638,039 | Carrier rejected — usually a dead/landline number |
| `sent` | 64,402 | Handed to carrier, no confirmation back |
| `failed` | 58,038 | Send failed |

Each row links to **either** `broadcast_id` **or** `campaign_id`. Note the volume split: broadcasts
account for ~98% of all sends. `is_second` marks the second message of a two-part send.
`recipient_phone_number` joins `authors.phone_number`.

## 3. Sending — broadcasts vs. campaigns

Two different systems, both still in use. **This distinction matters for almost every "what did we
send" question.**

**`broadcasts`** (294 rows) — the original recurring engine. Sends on a recurring weekly schedule
(`broadcast_settings` holds per-weekday send times). Each broadcast has a `first_message` and a
`second_message` sent after `delay`. Targets `audience_segments` via `broadcasts_segments` (with a
`ratio` for split testing). `no_users` is the intended recipient count.

**`campaigns`** (98 rows) — the newer one-off/ad-hoc system. Has `title`, `first_message`,
`second_message`, `run_at`, `recipient_count`, and `processed`. Recipients come from one of three
routes: `segments` (jsonb), an uploaded CSV (`recipient_file_url` → `campaign_file_recipients`), or
per-recipient custom text (`campaign_personalized_recipients`). `label_ids` links to Missive labels.

**`audience_segments`** (8 rows) — named, reusable cohorts. The `query` column holds the **raw SQL**
defining the segment. Read it to understand what a segment actually means before citing it.

`outgoing_messages` is the send queue (transient). `unsubscribed_messages` links STOP events to the
message that triggered them — useful for "which send drove unsubscribes."

## 4. Conversations and newsroom triage

**`conversations`** (616,470 rows) — one per Missive thread. `id` is a uuid used everywhere.
Useful columns: `messages_count`, `subject`, `assignee_names`, `assignee_emails`,
`shared_label_names`, `web_url` (direct Missive link), `closed`.

Join to people via **`conversations_authors`** (`conversation_id` ↔ `author_phone_number`).

**`conversations_labels`** + **`labels`** (198 labels) — the newsroom's tagging system, and the best
proxy for topic. **Always filter `is_archived = false`** — removed labels are soft-deleted, not
deleted, so omitting this roughly doubles counts.

Label vocabulary falls into three groups:
- **Lifecycle/system:** `undeliverable` (160k), `archive` (151k), `unsubscribed` (46.8k), `Replied` (23.2k)
- **Per-send campaign labels**, named `MM-DD-YY description` — e.g. `06-16-26 intent deadline july 1 to all`,
  `03-26-26 foreclosure deadline all`. These mark who received/replied to a given send.
- **Workflow/topic:** `Currently Assigned`, `Editor check - assign or decline`, `Address Lookup`,
  `WELCOME (texted in)`, `home repair`, `REPAY`, `CSV Uploads`

**`comments`** (5,230 rows) — internal staff notes on conversations. `body` is the note text,
`user_id` joins `users`, `is_task`/`task_completed_at` track follow-up. Internal newsroom
deliberation — handle as sensitive.

Assignment state lives in `conversations_assignees` / `conversations_users` (booleans:
`assigned`, `closed`, `archived`, `trashed`, `flagged`, `snoozed`), with history in
`conversations_assignees_history` and `conversation_history`.

> **Gotcha:** a conversation auto-archives the instant a resident texts STOP. A thread "disappearing"
> from a reporter's inbox usually means unsubscribe-triggered archiving, not deletion.

### AI conversation analysis — `conversation_analyses` (1,097 rows)

An LLM pipeline that tags inbound conversations for editorial value. Only **1,097 of 616k**
conversations are analyzed — this is a recent, partial pilot. **Never present these as
representative of the whole corpus.** Filter to `status = 'completed'` (1,068 rows; 26 pending,
3 skipped).

| Column | Notes |
|---|---|
| `tag` | Primary classification, from `analysis_tags` |
| `secondary_tags` | Array of additional tags |
| `topic`, `summary` | LLM-written topic and narrative summary |
| `supporting_quote` | **Verbatim resident SMS text** — most sensitive field here |
| `unmet_demand`, `unmet_demand_reason` | Flags a service need Outlier couldn't meet |
| `confidence` | 0–1 model confidence |
| `model`, `prompt_version` | Changes over time — **segment by these before comparing periods**, since tag distributions shift when the prompt changes |
| `promoted_at`, `promoted_by` | Escalated to the newsroom via Slack |

Active tag vocabulary (`analysis_tags`, all 10 currently active): `story-tip`, `unmet-demand`,
`info-gap`, `user-sat`, `reporter-engaged`, `no-impact`, `wrong-audience`, `unsubscribe`,
`automation-failure`, `noise-test`.

**`weekly_reports`** (179 rows) — pre-aggregated weekly metrics: `conversation_starters_sent`,
`broadcast_replies`, `text_ins`, `unsubscribes`, `failed_deliveries`, satisfaction and status
breakdowns (`status_tax_debt`, `status_foreclosed`, etc.), and engagement tiers (`replies_proactive`,
`replies_receptive`, `replies_connected`, `replies_passive`, `replies_inactive`). **Check here first
for trend questions** — it's far cheaper than aggregating millions of message rows.

## 5. Detroit property data — `address_lookup` schema

Backs the "Address Lookup" service where residents text an address and get back tax/rental status.

- **`mi_wayne_detroit`** (378,049 rows) — the full Detroit parcel file. ~190 columns: ownership
  (`owner`, `mailadd`, `previous_owner`), tax (`tax_status`, `tax_due`, `taxamt`, `amt_taxable_value`),
  structure (`yearbuilt`, `numunits`, `num_bedrooms`, `sqft`), sale history (`saleprice`, `saledate`,
  `grantee`), geography (`address`, `city`, `szip`, `council_district`, `ward`, `neighborhood`,
  `census_tract`), and program status (`land_bank_inventory_status`, `vacant_land_program`).
  Join key to other sources: `parcelnumb`.
- **`residential_rental_registrations`** (39,100 rows) — rental registration compliance by `parcel_id`.
- **`posible_homeowner_windfalls`** (2,360 rows) — tax-foreclosure auction surplus: `parcel_id`,
  `street_address`, `minimum_bid`, `auction_sale_price`, `windfall_profit`, `owner_name_at_foreclosure`,
  `tax_auction_year`. (Table name is misspelled in the schema — `posible`, one "s".)

> **PostGIS is unavailable to you.** These tables have `wkb_geometry` columns but you cannot call
> `ST_*` functions. Use the plain `lat` / `lon` columns for any geographic work, and don't select
> `wkb_geometry`.

`lookup_history` (in `public`) logs address lookups residents actually requested — `address`,
`tax_status`, `rental_status`, `zip_code`. Good for demand analysis.

---

## Query patterns

**Active subscriber count** (exclude opt-outs and flagged records):
```sql
select count(*) from authors where unsubscribed = false and exclude = false;
```

**Delivery rate for a campaign:**
```sql
select twilio_sent_status, count(*)
from message_statuses
where campaign_id = $1
group by 1;
```

**Inbound volume over time:**
```sql
select date_trunc('month', created_at) as month, count(*)
from twilio_messages
where is_reply = true and created_at >= now() - interval '12 months'
group by 1 order by 1;
```

**Conversations by label** (note the `is_archived` filter):
```sql
select l.name, count(*)
from conversations_labels cl
join labels l on l.id = cl.label_id
where cl.is_archived = false
group by 1 order by 2 desc;
```

**Replies attributable to a broadcast:**
```sql
select count(*) from twilio_messages
where is_reply = true and reply_to_broadcast = $1;
```

## Things that will trip you up

1. **`preview` is the message body**, despite the name.
2. **`is_reply` is the direction flag**, not a threading flag.
3. **Forgetting `is_archived = false`** on `conversations_labels` inflates counts ~2x.
4. **Broadcasts vs. campaigns are separate systems** — a query filtering only `broadcast_id` silently
   misses all campaign sends, and vice versa.
5. **`*_old` and `*_backfill` tables are snapshots**, not live data.
6. **`conversation_analyses` covers <0.2% of conversations** — never generalize from it.
7. **`undelivered` is huge (638k)** because the list contains many dead numbers. Always compute
   delivery rates against attempted sends, not against the subscriber list.
8. **Schema access is limited to `public` and `address_lookup`.** The `legacy` and `media` schemas
   exist but are not readable by this role — don't plan queries around them.
9. **`public.lookup_template` is deliberately blocked** and will return `permission denied`. It
   mixes SMS templates and prompt text with configuration that can hold credentials (a Missive token
   was stored there as a row until it was removed), so no analyst role can read it. This is
   intentional. Don't try to route around it.

## Answering well

Lead with the number and the time window it covers. State which tables it came from. When a count
could be read two ways (subscribers vs. deliverable subscribers; broadcasts vs. all sends), say which
you used. If a question needs Missive-side truth that may have drifted from this mirror, say so
rather than presenting a possibly-stale count as exact.
