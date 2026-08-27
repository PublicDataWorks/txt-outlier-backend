import { upsertConversation, upsertLabel } from './utils.ts'
import { RequestBody } from '../types.ts'
import supabase from '../../_shared/lib/supabase.ts'
import { reconcileAnalysisOrLog } from './analysis-reconcile.ts'

export const handleLabelChange = async (requestBody: RequestBody) => {
  await supabase.transaction(async (tx) => {
    await upsertConversation(tx, requestBody.conversation)
    await upsertLabel(tx, requestBody)
  })

  // After the transaction commits, so the reconciliation reads the labels as they now stand rather than
  // the uncommitted view inside it, and so a failure here cannot roll the label write back.
  if (requestBody.conversation?.id) {
    await reconcileAnalysisOrLog(requestBody.conversation.id)
  }
}
