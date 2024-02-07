## Full Flow of Broadcast v0.1

1. **Test Flow: Initial Setup**
  - Begin by creating an initial broadcast with the `runAt` field set in the near future, within the current day.
  - Populate the `audience_segments` table and `broadcasts_segments` accordingly.
  - Proceed to the next step once completed.

2. **Test Flow: Making Broadcast**
  - Start by accessing the entry point API `/make`.
  - Upon invoking the `/make` endpoint, retrieve the nearest available broadcast for that day.
  - Generate broadcast entries according to the data from step 1 and push them to the `outgoing_message` table.
  - Create the next broadcast with a `runAt` time on the next working day.
  - Create a cron job named `send-first-messages` to handle sending the first batch of messages.
  - Also, create a cron job named `invoke-broadcast` set to run on the next working day.
  - Mark the handled broadcast as processed and return.
  - Proceed to the next step

3. **Test Flow: `send-first-messages`**
  - Once the cron job is scheduled, trigger an API call to the `/broadcasts/draft/:broadcastID` endpoint.
  - This cron job runs every minute.
  - Under the hood, call the `sendBroadcastMessage` service function to get 50 pending broadcast messages according to the `:broadcastID` parameter, with the default `isSecond` query parameter set to false.
  - If no results are found, proceed to unschedule itself and create the `sendSecondMessagesCron`, setting the `startTime` at the time when the last batch of `first-messages` was sent.
  - If results are found, update the rows to have a `processed` status of `true`.
  - Loop over the rows, sending Missive messages to the `recipientPhoneNumber` with a limit of 1 second per request and a hard-cap of 60 seconds for the loop.
  - Save successfully sent messages to the `broadcast_sent_message_status` table and delete them from the `outgoing_message` table.
  - Set the `processed` status back to `false` for failed-to-send or not-processed-in-time records, releasing them back to the pool for the next run.
  - Proceed to the next step if the API endpoint executes the logic successfully.

4. **Test Flow: `send-second-messages`**
  - This cron job combines `delay-send-second-messages` and `send-second-messages`.
  - `delay-send-second-messages` runs once with a scheduled time 10 minutes (configurable) from the `startTime` of the last batch of `first-messages`.
  - Run a query to delete all pending second broadcast messages that have received a reply within the timeframe and then create the `send-second-messages` cron.
  - The logic is relatively the same as `send-first-messages`, running every minute, calling the `/broadcasts/draft/:broadcastID?isSecond=true` endpoint with the `isSecond` query parameter.
  - When no more rows can be retrieved, unschedule itself and `delay-send-second-messages`, and start the `twilio-status` cron.
  - Proceed to the next step.

5. **Test Flow: `twilio-status`**
  - This cron job runs every minute.
  - Invoke the `/broadcasts/twilio/:broadcastID` endpoint.
  - Get all Twilio message history of the broadcast number for that day up to the invocation time, with a limit of 100 results at a time.
  - If results are found, update the `broadcast` table to set the `twilio_paging` column with the next page of results.
  - Update the `broadcast_sent_message_status` table with `twilio_send_at`, `twilio_sent_status`, and `twilio_id` of each message.
  - Continue with the next page of Twilio messages saved in `twilio_paging`. If no more results are available, unschedule itself and exit.
