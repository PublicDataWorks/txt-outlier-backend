# Personalized Campaign Recipients

This feature allows you to send one-time campaigns where each recipient receives a custom message tailored specifically for them.

## Operational Flow

#### Initiating a Personalized Campaign

1. Insert records into the `campaign_personalized_recipients` table.
2. The `trigger_process_campaign_personalized_recipient_batch` trigger activates automatically.
3. The trigger creates a new campaign record in the `campaigns` table.
4. The trigger then queues all personalized messages directly to `broadcast_first_messages`.
5. Each recipient receives their custom message instead of a standard campaign message.

## How to Use

### 1. Prepare Your CSV File

Create a simple CSV file with two columns:
- `phone_number`: The recipient's phone number
- `message`: The personalized message for this recipient

Example CSV format:
```csv
phone_number,message
+15551234567,Hi John! Here's your special message about the upcoming event.
15557890123,Hello Sarah! This is a personalized notification for you.
+15552468101,Hey Mark! Just wanted to send you this custom reminder.
```

For convenience, you can [download a sample CSV template](sample_personalized_campaign.csv) to get started quickly.

**Note about phone numbers**: Phone numbers can be in any format - with or without the "+" prefix. The system will automatically add the "+" prefix to any phone number that doesn't already have it.

### 2. Import the CSV Through Supabase Dashboard

1. Log in to your Supabase dashboard
2. Navigate to the Table Editor
3. Find the `campaign_personalized_recipients` table
4. Click "Insert" -> "Import data from CSV" and select your CSV file
5. Make sure the column names match exactly: `phone_number` and `message`
6. Complete the import

### 3. Automatic Processing

- The system will automatically:
  - Create a single campaign record for all messages imported at once
  - Format phone numbers with a leading "+" sign if not already present
  - Send all messages to the [queue](https://supabase.com/dashboard/project/<projectId>/integrations/queues/queues) for processing as a batch
  - Remove the processed records from the table
  - Track all messages in the standard message tracking system under the same campaign

### Important Notes

- Messages are sent immediately upon import
- Each row in your CSV becomes one personalized message
- Recipients won't receive follow-up messages
- All messages track as part of the same campaign for reporting
- The system uses existing delivery infrastructure and respects unsubscribe settings

## Troubleshooting

If messages aren't being sent:
- Check that your CSV format is correct with exactly two columns
- Verify phone numbers are in the expected format
- Check the [Supabase PostgreSQL logs](https://supabase.com/dashboard/project/<projectId>/logs/postgres-logs) or [send-messages function logs](https://supabase.com/dashboard/project/<projectId>/functions/send-messages/logs) for any errors
