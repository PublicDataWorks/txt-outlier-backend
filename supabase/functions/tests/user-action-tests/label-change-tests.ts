import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import '../setup.ts'
import { labelChangeRequest } from '../fixtures/label-change-request.ts'
import { labels } from '../../_shared/drizzle/schema.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { client } from '../utils.ts'

const FUNCTION_NAME = 'user-actions/'

describe(
  'Label change',
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    it('new', async () => {
      const existingLabel = await supabase.select().from(labels)
      assertEquals(existingLabel.length, 0)
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: labelChangeRequest,
      })

      const label = await supabase.select().from(labels)
      assertEquals(label.length, 1)
      const requestLabel = labelChangeRequest.conversation.shared_labels[0]
      assertEquals(label[0].name, requestLabel.name)
      assertEquals(
        label[0].nameWithParentNames,
        requestLabel.name_with_parent_names,
      )
      assertEquals(label[0].color, requestLabel.color)
      assertEquals(label[0].parent, requestLabel.parent)
      assertEquals(
        label[0].shareWithOrganization,
        requestLabel.share_with_organization,
      )
      assertEquals(label[0].visibility, requestLabel.visibility)
    })

    it('upsert', async () => {
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: labelChangeRequest,
      })
      const newLabelChange = JSON.parse(JSON.stringify(labelChangeRequest))
      newLabelChange.conversation.shared_labels[0].name = 'new name'
      await client.functions.invoke(FUNCTION_NAME, {
        method: 'POST',
        body: newLabelChange,
      })
      const label = await supabase.select().from(labels)
      assertEquals(label.length, 1)

      const requestLabel = labelChangeRequest.conversation.shared_labels[0]
      assertEquals(label[0].name, 'new name')
      assertEquals(
        label[0].nameWithParentNames,
        requestLabel.name_with_parent_names,
      )
      assertEquals(label[0].color, requestLabel.color)
      assertEquals(label[0].parent, requestLabel.parent)
      assertEquals(
        label[0].shareWithOrganization,
        requestLabel.share_with_organization,
      )
      assertEquals(label[0].visibility, requestLabel.visibility)
    })
  },
)
