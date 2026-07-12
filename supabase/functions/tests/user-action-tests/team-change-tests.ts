import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import '../setup.ts'
import { teams } from '../../_shared/drizzle/schema.ts'
import { teamChangeRequest } from '../fixtures/team-change-request.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { client } from '../utils.ts'

const FUNCTION_NAME = 'user-actions/'

describe(
  'Team',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('change', async () => {
      const existingTeams = await supabase.select().from(teams)
      assertEquals(existingTeams.length, 0)
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: teamChangeRequest,
      })
      const newTeam = await supabase.select().from(teams)
      assertEquals(newTeam.length, 1)
      assertEquals(newTeam[0].id, teamChangeRequest.conversation.team!.id)
      assertEquals(newTeam[0].name, teamChangeRequest.conversation.team!.name)
      assertEquals(
        newTeam[0].organizationId,
        teamChangeRequest.conversation.team!.organization,
      )
    })

    it('upsert', async () => {
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: teamChangeRequest,
      })
      const body = JSON.parse(JSON.stringify(teamChangeRequest))
      body.conversation.team.name = 'new name'
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: body,
      })

      const newTeam = await supabase.select().from(teams)
      assertEquals(newTeam.length, 1)
      assertEquals(newTeam[0].id, teamChangeRequest.conversation.team!.id)
      assertEquals(newTeam[0].name, 'new name')
      assertEquals(
        newTeam[0].organizationId,
        teamChangeRequest.conversation.team!.organization,
      )
    })
  },
)
