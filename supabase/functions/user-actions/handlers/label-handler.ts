import { upsertConversation, upsertLabel, upsertRule } from './utils.ts'
import { RequestBody } from '../types.ts'
import supabase from '../../_shared/lib/supabase.ts'

export const handleLabelChange = async (requestBody: RequestBody) => {
  await supabase.transaction(async (tx) => {
    await upsertRule(tx, requestBody.rule)
    await upsertConversation(tx, requestBody.conversation)
    await upsertLabel(tx, requestBody)
  })
}
