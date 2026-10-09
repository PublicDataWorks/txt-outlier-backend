BEGIN;

SELECT plan(3);

SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'weekly-conversation-digest'),
  '0 13,14 * * 4',
  'weekly digest wakes at both UTC hours that can be 9 AM Eastern'
);

SELECT ok(
  position('America/New_York' IN (SELECT command FROM cron.job WHERE jobname = 'weekly-conversation-digest')) > 0,
  'weekly digest command checks the Eastern time zone'
);

SELECT ok(
  position('= 9' IN (SELECT command FROM cron.job WHERE jobname = 'weekly-conversation-digest')) > 0,
  'weekly digest command only invokes at 9 AM Eastern'
);

SELECT * FROM finish();

ROLLBACK;
