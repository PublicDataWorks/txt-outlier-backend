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
