# Outlier backend

## Key Features

- **Broadcast and Campaign Scheduling**: Utilize `make` and `campaign` edge functions to schedule and initiate
  broadcasts and campaigns based on predefined times.
- **Audience Segmentation**: Leverage the `make` edge function to retrieve and process audience segments from
  `audience_segment` and `broadcast_segment` tables, ensuring targeted message delivery.
- **Two-phase Message Sending**: Implement the `send-messages` edge function to send initial and follow-up messages via
  the Missive API, managing both broadcast and campaign queues.
- **Twilio Integration**: Use the `reconcile-twilio-status` edge function to update message statuses from Twilio,
  ensuring accurate tracking of message delivery.
- **Message Status Tracking**: Monitor message statuses through the `send-messages` and `reconcile-twilio-status` edge
  functions, handling success and failure scenarios.
- **Unsubscribe Handling**: Manage unsubscription requests with the `admin-action` edge function, triggered by Missive
  rules, and update the `unsubscribe` field accordingly.
- **Failed Message Handling**: Use `handle-failed-deliveries` to process conversations with multiple failed messages,
  applying the `undeliverable` label and updating the `unsubscribe` field.
- **Message Archival**: Implement `archive-double-failures` to archive conversations with consecutive failed messages,
  moving them out of the team inbox.
- **User Interaction Management**: The `user-action` edge function listens to Missive webhooks to manage user replies,
  removing follow-up messages when users respond.
- **Broadcast Configuration**: Utilize `broadcast-setting` and `broadcast-sidebar` edge functions to set up and manage
  broadcast schedules and content via the Missive broadcast sidebar.
- **Personalized Campaign Messages**: Send individualized messages to recipients where each person receives a unique
  custom message, using database triggers to automatically process and queue messages.

## Technical Stack

- **Language**: Deno
- **Hosting**: Supabase Edge Functions
- **Database**: PostgreSQL (Supabase)
- **Job Scheduling**: pg_cron (Supabase)

## Running Locally

Follow these steps to run the project locally:

1. Set up environment files - see [Environment Files Documentation](docs/environment-files.md)

2. Run:

```bash
deno task dev
```

## Testing

- Run `deno task test:setup`.

- Run `deno task test`.

- Run
  `deno task test:db`.

## Developer Tasks

- **Run the application**: `deno task dev`
- **Run tests**: `deno task test`
- **Setup test environment**: `deno task test:setup`
- **Run database tests**: `deno task test:db`
- **Run linter**: `deno task lint`
- **Format code**: `deno task fmt`
- **Stop the local Supabase environment**: `supabase stop --no-backup`
  - Use this to remove local Supabase containers and ensure a fresh start, which is **required** for new migrations to
    be applied correctly by `deno task dev`.

## Database Migrations

- Migration files reside in `supabase/migrations`.
- **Development:** Upon running `deno task dev` in a fresh environment (after `supabase stop --no-backup`), all
  migrations are automatically applied for local development.
- **Production:** New migrations must be applied **manually** by executing the SQL from the relevant file(s) directly
  against the production database (e.g., via the Supabase SQL Editor). Note: Ensure you apply them in the correct order.
- Refer to the Supabase documentation for
  concepts: [Supabase Database Migrations Guide](https://supabase.com/docs/guides/deployment/database-migrations)
- `<!-- TODO: Integrate automated database migration deployment to production when a CI/CD pipeline is implemented. -->`

## Deployment

Currently, there is no Continuous Deployment pipeline configured for this project. Therefore, developers must manually
deploy any changes to the Supabase Edge Functions.

Please follow the official Supabase documentation for detailed deployment
instructions: [Supabase Functions Deployment Guide](https://supabase.com/docs/guides/functions/deploy)

## Edge Functions

The following edge functions are utilized within the broadcast and campaign systems:

1. **make**: Runs a broadcast that is expected to run at the calling time. It retrieves segments linked to a broadcast
   and enqueues phone numbers to `broadcast_first_messages`, called by the `check-and-trigger-broadcast-every-minute`
   cron job.
2. **send-messages**: Pulls messages from queues and sends SMS via the Missive API, handling success and failure
   scenarios, called by the `send-messages` cron job.
3. **reconcile-twilio-status**: Updates the status of broadcast and campaign messages using the Twilio API, called by
   `daily-reconciliation`.
4. **handle-failed-deliveries**: Processes conversations with multiple failed messages, applies the `undeliverable`
   label, and updates the `unsubscribe` field, called by `daily-failed-deliveries-setup`.
5. **archive-double-failures**: Applies the `archive` label to conversations with two consecutive failed messages,
   called by `daily-archive-double-failures-setup`.
6. **user-action**: Listens to the Missive webhook and helps the broadcast and campaign processes when there's a reply.
   It removes follow-up messages from `broadcast_second_messages` when users reply to the first message.
7. **admin-action**: Called by Missive rule when an admin comments "unsubscribe" or "stop". It will mark `unsubscribe`
   to `True` for that phone number and send a post to Missive to notify the team.
8. **broadcast-setting**: Called by the broadcast sidebar on Missive, letting the admin team set up the broadcast
   schedule. Note: time is in Detroit.
9. **broadcast-sidebar**: Used by the broadcast sidebar on Missive to get a list of broadcasts and let admins update
   upcoming broadcast message content.
10. **campaign**: API to get/create/update/delete campaign.

## Broadcast and Campaign System Documentation

### System Components

#### Queues

1. **broadcast_first_messages**: Queue for initial messages of both broadcast and campaign campaigns.
2. **broadcast_second_messages**: Queue for follow-up messages of both broadcast and campaign campaigns.

#### Triggers

1. **outlier_on_broadcast_first_messages_insert**: Trigger that activates when a new message is enqueued in
   `broadcast_first_messages`. It sets up a cron job to run every 2 seconds, which calls the `send-messages` edge
   function.
2. **outlier_on_broadcast_first_messages_delete**: Trigger that runs when a message is removed from
   `broadcast_first_messages`.
3. **outlier_on_broadcast_second_messages_insert**: Trigger that activates when a new message is enqueued in
   `broadcast_second_messages`. It sets up a cron job to run every 2 seconds, which calls the `send-messages` edge
   function.
4. **outlier_on_broadcast_second_messages_delete**: Trigger that runs when a message is removed from
   `broadcast_second_messages`.
5. **trigger_process_campaign_personalized_recipient_batch**: Statement-level trigger that activates when new records are inserted into the
   `campaign_personalized_recipients` table, automatically creating a single campaign for all records and queuing personalized messages in a batch.

#### Scheduled Jobs

1. **check_and_trigger_broadcast**: Runs every minute to initiate broadcasts based on schedule.
2. **check_and_run_campaigns**: Runs every minute to initiate campaigns based on schedule.
3. **daily-reconciliation**: Runs daily to update message statuses from Twilio.
4. **daily-failed-deliveries-setup**: Runs daily to handle failed message deliveries.
5. **daily-archive-double-failures-setup**: Runs daily to archive conversations with multiple failed messages.

#### Functions

1. **queue_broadcast_messages**: Function to queue messages for broadcasting.
2. **check_and_run_campaigns**: PostgreSQL function that checks the `run_at` field of the `campaign` table and enqueues
   messages to `broadcast_first_messages`.
3. **process_campaign_personalized_recipient_batch**: Function that processes batches of personalized campaign recipients and queues messages
   for sending.

### Operational Flow

#### Initiating a Broadcast

1. **check_and_trigger_broadcast** checks the nearest upcoming broadcast record where `editable = False`.
  - If `run_at` is set, it uses this field to determine the run time.
  - Otherwise, it calculates the run time from `broadcast_settings` (in Detroit time zone).
2. If the current time matches the calculated run time (at the minute level), `check_and_trigger_broadcast` calls the
   `make` edge function.

#### Initiating a Campaign

1. **check_and_run_campaigns** checks the `run_at` field of the `campaign` table.
2. If the current time matches the `run_at` time (at the minute level), `check_and_run_campaigns` enqueues messages
   directly to `broadcast_first_messages`.

#### Initiating a Personalized Campaign

1. Insert records into the `campaign_personalized_recipients` table.
2. The `trigger_process_campaign_personalized_recipient` trigger activates automatically.
3. The trigger creates a new campaign record in the `campaigns` table.
4. The trigger then queues all personalized messages directly to `broadcast_first_messages`.
5. Each recipient receives their custom message instead of a standard campaign message.

#### Message Processing (Common for Broadcast and Campaign)

3. **make** edge function (for broadcasts) retrieves segments linked to the broadcast from `audience_segment` and
   `broadcast_segment` tables.
  - Segments are processed to obtain phone numbers, excluding those where `excluded = True`, `unsubscribe = True`, or
    `added_via_file_upload = True`.
  - The retrieved phone numbers are enqueued to `broadcast_first_messages`.

4. **outlier_on_broadcast_first_messages_insert** triggers immediately upon enqueueing a new message, setting up a cron
   job that runs every 2 seconds to call `send-messages`.

5. **send-messages** edge function:
  - Pulls one message from either `broadcast_first_messages` or `broadcast_second_messages`.
  - Calls the Missive API to send the SMS.
    - If successful and from `broadcast_first_messages`, enqueues a follow-up message to `broadcast_second_messages`.
    - If successful, removes the message from the queue.
    - If failed, leaves the message in the queue with a 3-minute sleep.
    - If failed 3 times (excluding 429 errors), deletes the message from the queue.

6. **outlier_on_broadcast_second_messages_delete** runs once the `broadcast_second_messages` queue is depleted, cleaning
   up the cron job.

#### Post-Broadcast and Campaign Handling (Common for Broadcast and Campaign)

7. **daily-reconciliation** runs to call the `reconcile-twilio-status` edge function, which updates the Twilio status
   for every broadcast and campaign sent message. This job is crucial as some Twilio SMS status updates may be delayed
   by 1-2 days.

8. **daily-failed-deliveries-setup** calls `handle-failed-deliveries`:
  - Identifies conversations with 3 latest messages that are all failed and have never received a reply.
  - Applies the `undeliverable` label to these conversations, moving them out of the team inbox.
  - Updates the `unsubscribe` field to `True` for the corresponding phone number in the `author` table.

9. **daily-archive-double-failures-setup** calls `archive-double-failures`:
  - Applies the `archive` label to conversations with 2 latest messages that are failed.
  - This label moves the conversation out of the team inbox.

### Additional Notes

- **User Replies**: If users reply after receiving the first message, the `user-action` edge function removes the
  follow-up message from `broadcast_second_messages` for that user.
- **Admin Actions**: The `admin-action` edge function is triggered by Missive rules to handle unsubscription requests
  from admins, updating the `unsubscribe` field and notifying the team.
- **Personalized Campaigns**: The personalized campaign feature allows for one-time campaigns where each recipient
  receives a custom message. This is implemented through database triggers that automatically process and queue messages
  when records are inserted into the `campaign_personalized_recipients` table.
  See [Personalized Campaigns Documentation](docs/personalized-campaigns.md) for usage instructions.

### Developer Notes

- Ensure that the system time is synchronized with the server hosting the application to prevent timing discrepancies.
- Monitor the queues and scheduled jobs to ensure smooth operation and timely processing of messages.
- Regularly review and update the segment queries to ensure they exclude the appropriate phone numbers (excluded,
  unsubscribe, added_via_file_upload). Note: The added_via_file_upload field should always be excluded in broadcast
  segment queries because these authors were recipients added through campaign file uploads and were not intended to be
  part of broadcasts. Including them in broadcasts could lead to unintended message delivery and potential compliance
  issues.
-

## Related Repositories

- **Missive sidebars**
  - https://github.com/PublicDataWorks/txt-outlier-frontend
- **Lookup backend**
  - https://github.com/PublicDataWorks/txt-outlier-lookups
