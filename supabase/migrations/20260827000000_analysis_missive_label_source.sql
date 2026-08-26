-- Use the newsroom's own Missive impact labels as the authoritative outcome, instead of inferring every
-- tag from the SMS transcript.
--
-- Motivation, measured against production before this change: of 224 analyzed conversations carrying a
-- human '..Impact Labels/*' label, the model agreed with the newsroom on 15. It classified 159
-- "Info gap filled" and 109 "user satisfaction" conversations as reporter-engaged, because Outlier's
-- automated replies are signed with staff names and the model reads a signature as a person having
-- engaged. The system prompt already warned against exactly that and it did not hold.
--
-- model_tag preserves what the model chose even when a label overrides it, so the agreement rate stays
-- measurable rather than being silently overwritten.

ALTER TABLE conversation_analyses
  ADD COLUMN model_tag TEXT,
  ADD COLUMN tag_source TEXT CHECK (tag_source IN ('missive-label', 'model')),
  ADD COLUMN missive_labels TEXT[] DEFAULT '{}';

CREATE INDEX idx_conversation_analyses_tag_source ON conversation_analyses (tag_source);

COMMENT ON COLUMN conversation_analyses.model_tag IS
  'The tag the model chose, retained even when a Missive impact label overrode it.';
COMMENT ON COLUMN conversation_analyses.tag_source IS
  'Where the final tag came from: a human Missive impact label, or the model.';
COMMENT ON COLUMN conversation_analyses.missive_labels IS
  'Missive labels present on the conversation at analysis time, for later audit.';
