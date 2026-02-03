import { ensureRuleExists, upsertConversation, upsertLabel } from './utils.ts'
import { RequestBody } from '../types.ts'
import supabase from '../../_shared/lib/supabase.ts'

export const handleLabelChange = async (requestBody: RequestBody) => {
  await ensureRuleExists(requestBody.rule)
  await supabase.transaction(async (tx) => {
    await upsertConversation(tx, requestBody.conversation)
    await upsertLabel(tx, requestBody)
  })
}
