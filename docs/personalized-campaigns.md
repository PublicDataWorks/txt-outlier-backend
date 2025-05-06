# Personalized Campaigns

This feature allows you to send one-time campaigns where each recipient receives a custom message tailored specifically for them.

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

**Note about phone numbers**: Phone numbers can be in any format - with or without the "+" prefix. The system will process both formats correctly.

### 2. Import the CSV Through Supabase Dashboard

1. Log in to your Supabase dashboard
2. Navigate to the Table Editor
3. Find the `personalized_campaign_messages` table
4. Click "Import" and select your CSV file
5. Make sure the column names match exactly: `phone_number` and `message`
6. Complete the import

### 3. Automatic Processing

- The system will automatically:
  - Create a campaign record with a timestamp-based name
  - Send each message to the queue for processing
  - Remove the record from the table after successful queuing
  - Track the message in the standard message tracking system

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
- Check the Supabase logs for any errors
- Make sure the migration has been applied properly

Need help? Contact the development team for assistance.