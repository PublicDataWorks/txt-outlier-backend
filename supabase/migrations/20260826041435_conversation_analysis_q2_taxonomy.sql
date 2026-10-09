-- Q2 revision: swap the placeholder taxonomy for the evidence-based one derived from an audit of
-- 776 hand-coded real conversations (see the historical-audit report), add the 3-day close delay,
-- and add a suppression reason distinct from a processing error.

ALTER TABLE conversation_analyses
  ADD COLUMN topic TEXT,
  ADD COLUMN process_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN suppress_reason TEXT;

CREATE INDEX idx_conversation_analyses_process_after ON conversation_analyses (process_after) WHERE status = 'pending';
CREATE INDEX idx_conversation_analyses_topic ON conversation_analyses (topic);

-- Replace the placeholder taxonomy. The PR hasn't shipped yet, so a hard reseed (rather than an
-- active-flag migration) is safe here.
DELETE FROM analysis_tags;

INSERT INTO analysis_tags (name, description) VALUES
  ('reporter-engaged', 'A named Outlier journalist or staff member personally engaged and responded to the resident, beyond an automated reply'),
  ('info-gap', 'A concrete question was answered correctly via automation or keyword menu with no reporter time spent'),
  ('user-sat', 'Resident was connected to a concrete program/referral and expressed explicit satisfaction or gratitude, or the thread shows a clear positive outcome'),
  ('story-tip', 'Resident surfaced information a reporter could turn into a story or investigation, regardless of whether their own request was resolved'),
  ('unmet-demand', 'Resident expressed a real, in-scope need the service did not resolve within the thread'),
  ('unsubscribe', 'Resident explicitly opted out (STOP/unsubscribe), typically in response to an unsolicited broadcast'),
  ('no-impact', 'Resident received a broadcast or one-off message and took no further action of any kind'),
  ('wrong-audience', 'Message reached someone it was never meant for (wrong number, minor, out-of-area, mismatched targeting)'),
  ('automation-failure', 'A system bug independent of resident behavior, such as messages continuing after a confirmed STOP or duplicate sends'),
  ('noise-test', 'Hostile, harassing, gibberish, or apparent test content with no real service value')
ON CONFLICT (name) DO NOTHING;
