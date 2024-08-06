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
