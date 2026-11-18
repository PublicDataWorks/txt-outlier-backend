-- Align the info-gap, reporter-engaged and no-impact descriptions with the newsroom's own definition of
-- "Info gap filled" (agreed with Outlier on Oct 7): a staff member personally answered a resident's specific
-- information need with usable information. The Q2 description said the opposite ("answered via automation or
-- keyword menu with no reporter time spent"), so the model filed automated replies under the outcome the
-- newsroom counts as its most important. These descriptions are shown to the model as the taxonomy, alongside
-- the fuller rules in AnalysisService's prompt (PROMPT_VERSION q4-v1-info-gap-definition).
--
-- Only descriptions change: tag names, active flags and every stored analysis are untouched. To roll back, set
-- the three descriptions back to the values in 20260826041435_conversation_analysis_q2_taxonomy.sql.

UPDATE analysis_tags
SET description = 'A staff member personally answered the resident''s specific question about their own situation with usable information (a fact, rule, eligibility answer, deadline, contact, location or next step). Automated keyword, broadcast or campaign replies alone never count'
WHERE name = 'info-gap';

UPDATE analysis_tags
SET description = 'A staff member personally engaged with the resident one-on-one (a check-in they answered, an offer to look into something, a back-and-forth) without delivering a specific answer to a specific need. Signed automated replies do not count'
WHERE name = 'reporter-engaged';

UPDATE analysis_tags
SET description = 'Resident received broadcast, campaign or automated content, or a staff check-in, and took no further meaningful action'
WHERE name = 'no-impact';
