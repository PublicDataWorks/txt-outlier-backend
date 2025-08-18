export interface QueuedMessageMetadata {
  recipient_phone_number: string
  first_message: string
  second_message?: string
  broadcast_id?: number
  campaign_id?: number
  segment_id?: number
  delay?: number
  label_ids?: string[]
  campaign_segments?: {
    included?: Array<{ id: string; since?: number }>
    excluded?: Array<{ id: string; since?: number }>
  }
  conversation_id?: string
  title?: string
  created_at?: number
}
