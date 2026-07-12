-- AI conversation tagging: analysis results, curated tag taxonomy, and the cron jobs that
-- drive the realtime queue processor and the weekly digest.

CREATE TABLE conversation_analyses (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  conversation_id UUID NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  source TEXT NOT NULL DEFAULT 'realtime' CHECK (source IN ('realtime', 'backfill')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  tag TEXT,
  secondary_tags TEXT[] DEFAULT '{}',
  summary TEXT,
  supporting_quote TEXT,
  unmet_demand BOOLEAN NOT NULL DEFAULT FALSE,
  unmet_demand_reason TEXT,
  confidence REAL,
  model TEXT,
  prompt_version TEXT,
  message_count INTEGER,
  last_message_at TIMESTAMPTZ,
  slack_channel TEXT,
  slack_message_ts TEXT,
  promoted_at TIMESTAMPTZ,
  promoted_by TEXT
);

CREATE INDEX idx_conversation_analyses_status ON conversation_analyses (status);
CREATE INDEX idx_conversation_analyses_tag ON conversation_analyses (tag);
CREATE INDEX idx_conversation_analyses_created_at ON conversation_analyses (created_at);
CREATE INDEX idx_conversation_analyses_unmet_demand ON conversation_analyses (unmet_demand) WHERE unmet_demand;

CREATE TABLE analysis_tags (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO analysis_tags (name, description) VALUES
  ('housing', 'Housing conditions, evictions, landlord disputes, home repair, or housing assistance'),
  ('utilities', 'Water, gas, electric, internet, or other utility service issues and shutoffs'),
  ('employment', 'Job search, unemployment benefits, workplace issues, or job training'),
  ('food-assistance', 'SNAP benefits, food banks, school meals, or other food assistance needs'),
  ('transportation', 'Public transit, DDOT/SMART bus routes, road conditions, or car-related needs'),
  ('health', 'Physical or mental health care access, insurance coverage, or public health concerns'),
  ('public-safety', 'Crime, policing, violence, or neighborhood safety concerns'),
  ('education', 'Schools, enrollment, childcare, or other educational resources'),
  ('legal-aid', 'Legal questions, court issues, tenant rights, or need for legal representation'),
  ('civic-info', 'Elections, voting, city services, government programs, or civic participation'),
  ('story-tip', 'A tip or lead for a potential Outlier Media news story'),
  ('service-feedback', 'Feedback, praise, or complaints about the Outlier Media SMS service itself'),
  ('other', 'Does not fit any other category in the taxonomy')
ON CONFLICT (name) DO NOTHING;

-----------------------------------------------

CREATE OR REPLACE FUNCTION public.trigger_conversation_analysis_queue()
RETURNS void AS $$
DECLARE
    service_key TEXT;
    edge_url TEXT;
BEGIN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'secret_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    PERFORM net.http_post(
        url:=edge_url || 'conversation-analysis/',
        headers:=jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', service_key
        ),
        body:=jsonb_build_object('action', 'process-queue', 'batchSize', 5)
    );
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule(
    'analyze-conversations',
    '* * * * *',
    'SELECT public.trigger_conversation_analysis_queue();'
);

-----------------------------------------------

CREATE OR REPLACE FUNCTION public.trigger_weekly_conversation_digest()
RETURNS void AS $$
DECLARE
    service_key TEXT;
    edge_url TEXT;
BEGIN
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'secret_key';

    SELECT decrypted_secret INTO edge_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_function_url';

    PERFORM net.http_post(
        url:=edge_url || 'weekly-digest/',
        headers:=jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', service_key
        ),
        body:=jsonb_build_object()
    );
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule(
    'weekly-conversation-digest',
    '0 14 * * 1',
    'SELECT public.trigger_weekly_conversation_digest();'
);
