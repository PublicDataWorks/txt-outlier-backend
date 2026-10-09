import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import '../setup.ts'
import { rules } from '../../_shared/drizzle/schema.ts'
import { teamChangeRequest } from '../fixtures/team-change-request.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { client } from '../utils.ts'

const FUNCTION_NAME = 'user-actions/'

describe(
  'ensureRuleExists',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('inserts rule when it does not exist', async () => {
      const existingRules = await supabase.select().from(rules)
      assertEquals(existingRules.length, 0)

      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: teamChangeRequest,
      })

      const newRules = await supabase.select().from(rules)
      assertEquals(newRules.length, 1)
      assertEquals(newRules[0].id, teamChangeRequest.rule.id)
      assertEquals(newRules[0].description, teamChangeRequest.rule.description)
      assertEquals(newRules[0].type, teamChangeRequest.rule.type)
    })

    it('handles concurrent calls with same rule ID without error', async () => {
      // Simulate concurrent webhooks sharing the same rule ID
      await Promise.all([
        client.functions.invoke(FUNCTION_NAME, {
          method: 'POST',
          body: teamChangeRequest,
        }),
        client.functions.invoke(FUNCTION_NAME, {
          method: 'POST',
          body: teamChangeRequest,
        }),
        client.functions.invoke(FUNCTION_NAME, {
          method: 'POST',
          body: teamChangeRequest,
        }),
      ])

      const allRules = await supabase.select().from(rules)
      assertEquals(allRules.length, 1)
      assertEquals(allRules[0].id, teamChangeRequest.rule.id)
    })

    it('does not update rule description on subsequent calls', async () => {
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: teamChangeRequest,
      })

      const body = JSON.parse(JSON.stringify(teamChangeRequest))
      body.rule.description = 'Updated description'
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: body,
      })

      const allRules = await supabase.select().from(rules)
      assertEquals(allRules.length, 1)
      // Description should remain unchanged (DO NOTHING behavior)
      assertEquals(allRules[0].description, teamChangeRequest.rule.description)
    })
  },
)
