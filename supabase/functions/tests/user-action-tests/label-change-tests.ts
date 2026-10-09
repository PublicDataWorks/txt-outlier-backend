import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

import '../setup.ts'
import { labelChangeRequest } from '../fixtures/label-change-request.ts'
import { conversationsLabels, labels } from '../../_shared/drizzle/schema.ts'
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

    // Removing a label archives its link. The unique index only covers active rows, so re-adding the label
    // inserts a fresh active row and leaves the archived one as history. conversation-analysis reads impact
    // labels filtered on is_archived = false, so exactly one active row must come back.
    it('makes a label active again when it is removed and then re-added', async () => {
      await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: labelChangeRequest })

      const [linked] = await supabase.select().from(conversationsLabels)
      assertEquals(linked.isArchived, false)

      // Same conversation, no labels: every link on it is archived.
      const removed = JSON.parse(JSON.stringify(labelChangeRequest))
      removed.conversation.shared_labels = []
      await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: removed })

      const afterRemoval = await supabase.select().from(conversationsLabels)
      assertEquals(afterRemoval.filter((row) => !row.isArchived).length, 0)

      await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: labelChangeRequest })

      const rows = await supabase.select().from(conversationsLabels)
      assertEquals(rows.filter((row) => !row.isArchived).length, 1, 'exactly one active link after re-adding')
      assertEquals(rows.filter((row) => row.isArchived).length, 1, 'the earlier link is kept as history')
    })

    it('does not duplicate a link that is already active', async () => {
      await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: labelChangeRequest })
      await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: labelChangeRequest })

      const rows = await supabase.select().from(conversationsLabels)
      assertEquals(rows.length, 1)
      assertEquals(rows[0].isArchived, false)
    })

    // The labels insert uses ON CONFLICT DO UPDATE, which Postgres aborts if one statement presents the same
    // conflict key twice ("cannot affect row a second time") - taking the whole webhook transaction with it.
    // Missive payloads are external input, so a repeated label must not be fatal.
    it('survives a payload that repeats the same label', async () => {
      const duplicated = JSON.parse(JSON.stringify(labelChangeRequest))
      duplicated.conversation.shared_labels = [
        duplicated.conversation.shared_labels[0],
        { ...duplicated.conversation.shared_labels[0] },
      ]

      await client.functions.invoke(FUNCTION_NAME, { method: 'POST', body: duplicated })

      assertEquals((await supabase.select().from(labels)).length, 1)
      const rows = await supabase.select().from(conversationsLabels)
      assertEquals(rows.length, 1)
      assertEquals(rows[0].isArchived, false)
    })
  },
)
