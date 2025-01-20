import { assertEquals } from 'testing/asserts.ts'
import { describe, it } from 'testing/bdd.ts'
import { FakeTime } from 'testing/time.ts'
import { invokeBroadcastCron } from '../scheduledcron/cron.ts'

describe(
  'Invoke broadcast cron',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it.only('creates correct cron job format', () => {
      using _time = new FakeTime(new Date('2024-01-31T06:16:57.000Z'))
      const runAt = new Date('2024-02-01T06:00:57.000Z')

      const expectedCron = `
        SELECT cron.schedule(
      'delay-invoke-broadcast',
      '0 6 1 2 4',
      $$
        SELECT cron.schedule(
          'invoke-broadcast',
          '* * * * *',
          'SELECT net.http_get(
          url:=''${Deno.env.get('BACKEND_URL')!}/broadcasts/make'',
          headers:=''{"Content-Type": "application/json", "Authorization": "Bearer ${Deno.env.get(
        'SUPABASE_SERVICE_ROLE_KEY',
      )!}"}''::jsonb) as request_id;'
        );
      $$
    );
      `

      const result = invokeBroadcastCron(runAt)
      assertEquals(result.trim(), expectedCron.trim())
    })
  },
)
