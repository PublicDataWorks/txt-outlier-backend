# Broadcaster backend (Deno)

## Project Overview

This project aims to replicate Twilio messaging and implement a periodic broadcast system. It includes a comprehensive flow for creating, scheduling, and sending broadcast messages to specific audience segments.

## Key Features

- Broadcast Creation and Scheduling
- Audience Segmentation
- Two-phase Message Sending (First and Second Messages)
- Twilio Integration for Message Delivery
- Message Status Tracking
- Unsubscribe Handling
- Cron Job Management for Automated Tasks

## Technical Stack

- **Language**: Deno
- **Hosting**: Amazon EC2
- **Database**: PostgreSQL (Supabase)
- **Job Scheduling**: pg_cron (Supabase)

## Running Locally

Follow these steps to run the project locally:

1. Create a `.env` file from the `.env-example` file.

2. Run:

```bash
deno task run
```

## Testing

- Run `supabase start`.

- Run `deno task test:dbSetup`.

- Run
  `deno task test`.

- Run `deno task test:dbTeardown`.

## API Overview

### POST /api/broadcasts/make

Purpose: Initiates the creation of a new broadcast.

Request Body: None

Response:

- Returns a 204 No Content status on success.

### GET /api/broadcasts/send-now

Purpose: Triggers the immediate sending of the next scheduled broadcast.

Request Body: None

Response:

- Returns a 204 No Content status on success.

### GET /api/broadcasts/draft/:broadcastID

Purpose: Sends either the first or second message of a specific broadcast.

Query Parameters:

- `isSecond` (Boolean, optional): If true, sends the second message. If false or omitted, sends the first message.

Response:

- Returns a 200 OK status with the result of the operation.

### GET /api/broadcasts

Purpose: Retrieves a list of all broadcasts.

Query Parameters:

- `limit` (Integer, optional): Number of broadcasts to retrieve.
- `cursor` (Integer, optional): Pagination cursor.

Response:

- Returns a JSON object containing the list of broadcasts and pagination information.

### PATCH /api/broadcasts/:id

Purpose: Updates an existing broadcast.

Request Body:

- `firstMessage` (String, optional): The updated first message.
- `secondMessage` (String, optional): The updated second message.
- `runAt` (Decimal, optional): The updated scheduled run time.
- `delay` (String, optional): The updated delay between messages.

Response:

- Returns a JSON object with the updated broadcast information.

### GET /api/broadcasts/:broadcastID/update-twilio-status

Purpose: Updates the Twilio status for messages in a specific broadcast.

Response:

- Returns a 204 No Content status on success.

## Database Overview

### Authors Table

```sql
create table public.authors (
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone,
  name text,
  phone_number text primary key not null,
  unsubscribed boolean not null default false,
  exclude boolean default false
) tablespace pg_default;
```

### Comments Table

```sql
create table public.comments (
  created_at timestamp with time zone not null default now(),
  body text,
  task_completed_at timestamp with time zone,
  user_id uuid not null references users(id) on delete cascade,
  is_task boolean not null default false,
  id uuid primary key not null default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  attachment text
) tablespace pg_default;
```

### Conversations Table

```sql
create table public.conversations (
  id uuid primary key not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  messages_count integer not null default 0,
  drafts_count integer not null default 0,
  send_later_messages_count integer not null default 0,
  attachments_count integer not null default 0,
  tasks_count integer not null default 0,
  completed_tasks_count integer not null default 0,
  subject text,
  latest_message_subject text,
  assignee_names text,
  assignee_emails text,
  shared_label_names text,
  web_url text not null,
  app_url text not null,
  updated_at timestamp with time zone,
  closed boolean,
  organization_id uuid references organizations(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade
) tablespace pg_default;
```

### Labels Table

```sql
create table public.labels (
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone,
  id uuid primary key not null default gen_random_uuid(),
  name text not null default '',
  name_with_parent_names text not null default '',
  color text,
  parent uuid,
  share_with_organization boolean not null default false,
  visibility text
) tablespace pg_default;
```

### Users Table

```sql
create table public.users (
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  email text,
  name text,
  avatar_url text,
  id uuid primary key not null
) tablespace pg_default;
```

### Broadcasts Table

```sql
create table public.broadcasts (
  id serial primary key not null,
  created_at timestamp with time zone not null default now(),
  run_at date not null,
  delay interval not null default '00:10:00',
  updated_at timestamp with time zone,
  editable boolean not null default true,
  no_users integer not null default 0,
  first_message text not null,
  second_message text not null,
  twilio_paging text
) tablespace pg_default;
```

### Organizations Table

```sql
create table public.organizations (
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone,
  name text not null,
  id uuid primary key not null default gen_random_uuid()
) tablespace pg_default;
```

### Audience Segments Table

```sql
create table public.audience_segments (
  id serial primary key not null,
  name text,
  created_at timestamp with time zone not null default now(),
  query text not null,
  description text not null
) tablespace pg_default;
```

### Lookup History Table

```sql
create table public.lookup_history (
  id serial primary key,
  address text not null,
  zip_code text not null,
  tax_status text not null,
  rental_status text not null,
  created_at timestamp with time zone not null default now()
) tablespace pg_default;
```


## Related Repositories

- **Missive conversation sidebar**
  - https://github.com/PublicDataWorks/txt-outlier-convo-sidebar
- **Missive broadcast sidebar**
  - https://github.com/PublicDataWorks/txt-outlier-frontend
- **Broadcast backend**
  - https://github.com/PublicDataWorks/txt-outlier-backend
- **Lookup backend**
  - https://github.com/PublicDataWorks/txt-outlier-lookups

## [Config Variables Description](https://github.com/PublicDataWorks/txt-outlier-lookups/blob/main/architecture.md)

### Variable Descriptions

1. `all_good`: A message sent when the user is finished with their inquiry.

2. `no_match`: A response when an address cannot be found in the database.

3. `wrong_format`: A message sent when the user inputs an address in an unrecognizable format.

4. `closest_match`: A message asking for confirmation when a similar address is found.

5. `return_info`: The main response containing property information.

6. `return_info2`: A follow-up message offering additional assistance.

7. `has_tax_debt`: Message provided when a property has tax debt.

8. `unregistered`: Message about unregistered rental properties.

9. `registered`: Message about registered rental properties.

10. `foreclosed`: Message for properties in foreclosure.

11. `forfeited`: Message for properties in forfeiture.

12. `final`: A closing message offering further assistance.

13. `match_second_message`: A follow-up message after providing property information.

14. `not_in_session`: A message indicating the user needs to start a lookup session.

15. `search_prompt`: Prompt for look-up LLM model to search.

16. `search_context`: Context and instructions for LLM to query the property database.

17. `search_context_with_sunit`: Similar to `search_context`, but includes unit information.

18. `land_bank`: Message about land bank properties.

19. `tax_unconfirmed`: Explanation of "unconfirmed" tax status.

20. `sms_history_summary`: Prompt for summary LLM to generate SMS conversation history.

21. `missive_report_conversation_id`: ID for the weekly report conversation in Missive.

22. `comment_summary_prompt`: Prompt for LLM model to summarize reporter comments.

23. `impact_summary_prompt`: Prompt for LLM model to summarize conversation outcomes and impact.

24. `message_summary_prompt`: Prompt for LLM model to summarize user communication patterns.

25. `keyword_label_parent_id`: ID for the parent label of keyword categories.

26. `impact_label_parent_id`: ID for the parent label of impact categories.

27. `max_tokens`: Maximum number of tokens for AI model responses.

28. `search_model`: The AI model used for search queries.

29. `summary_model`: The AI model used for generating summaries.

30. `missive_secret`: Secret key for Missive API authentication.

31. `outcome_title`: Title for the impact and outcomes section in convo sidebar.

32. `comments_title`: Title for the reporter notes section in convo sidebar.

33. `messages_title`: Title for the communication patterns section in convo sidebar.

34. `number of recipients for each batch`: Update the `no_users` column in the `broadcasts` table for the most recent broadcast (the one with the largest `id`)

## Deploy Steps:
### Full Flow of Deploying Backend

#### 1. AWS Console Access and Security Group Configuration

1. Log in to the AWS Management Console.
2. Navigate to the EC2 service.
3. In the left sidebar, under "Network & Security," click on "Security Groups."
4. Find and select the security group associated with your EC2 instance:
5. In the bottom pane, click on the "Inbound rules" tab.
6. Click the "Edit inbound rules" button.
7. Click "Add rule."
8. For the new rule, set the following:
   - Type: SSH
   - Protocol: TCP
   - Port Range: 22
   - Source: Custom
9. In the text box next to "Custom," enter the IP address you want to whitelist. Add "/32" at the end to specify a single IP (e.g., "203.0.113.0/32").
10. (Optional) Add a description for the rule to help you remember why it was added.
11. Click "Save rules" to apply the changes.

#### 2. Connecting to EC2 Instance

1. Request the pem file from developers/admins.
2. Use this command to connect:
```
ssh -i PEM_FILE EC2_IP_ADDRESS
```

#### 3. Accessing Tmux Instances

Once inside the EC2 instance, check for 2 tmux instances:

1. Backend instance (broadcaster deno backend):
   ```
   tmux a -t backend
   ```

2. Lookup instance (address lookup/conversation summary python backend):
   ```
   tmux a -t lookup
   ```

#### 4. Deploying Backend

[Lookup](https://github.com/PublicDataWorks/txt-outlier-lookups?tab=readme-ov-file#docker-quick-start)



### 4. Migrations and database schema
Refer to [user-actions](https://github.com/PublicDataWorks/txt-outlier-import/tree/main/supabase/functions/user-actions/drizzle) for more information
