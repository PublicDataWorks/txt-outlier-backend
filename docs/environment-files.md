# Environment Files

This project uses three different environment files for different purposes:

## 1. Root `.env` File

**Location**: `/.env`

**Purpose**: Used for local Supabase stack configuration during development.

**Contains**:
- Google OAuth credentials for local Supabase authentication
- Default local Supabase service keys and URLs

## 2. Edge Functions `.env` File

**Location**: `/supabase/functions/.env`

**Purpose**: Contains secrets and environment variables used by edge functions.

## 3. Testing `.env` File

**Location**: `/supabase/functions/tests/.env.testing`

**Purpose**: Used specifically for running tests locally.

## Setup Instructions

1. For local development:
   - Use `.env-example` files as templates

2. For production deployment:
   - Only `/supabase/functions/.env` needs to be deployed to production
   - Follow [Supabase Functions Secrets Management](https://supabase.com/docs/guides/functions/secrets) to deploy secrets
   - Production values should be obtained from 1Password's `txt-outlier-backend prod env` entry

## AI Conversation Tagging Variables

Added to `/supabase/functions/.env` for the [AI Conversation Tagging](conversation-tagging.md) feature:

| Variable                    | Required | Purpose                                                                 |
|------------------------------|----------|--------------------------------------------------------------------------|
| `ANTHROPIC_API_KEY`          | Yes      | Claude API key used to analyze conversation transcripts.                 |
| `ANALYSIS_MODEL`             | No       | Model id used for analysis. Defaults to `claude-sonnet-5`.                |
| `SLACK_BOT_TOKEN`            | Yes      | Slack bot token (`chat:write` scope) used to post and update messages.   |
| `SLACK_ANALYSIS_CHANNEL_ID`  | Yes      | Slack channel that receives analysis posts and the weekly digest.        |
| `SLACK_SIGNING_SECRET`       | Yes      | Verifies that requests to `slack-interactions` came from Slack.          |
| `DASHBOARD_TOKEN`            | No       | If set, required as `?token=` on every `insights-dashboard` request.      |
| `DASHBOARD_URL`              | No       | Public dashboard URL, linked from the weekly digest message when set.    |

See [Conversation Tagging Documentation](conversation-tagging.md) for the Slack app setup steps and full details.
