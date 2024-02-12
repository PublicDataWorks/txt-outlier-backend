import { OutgoingMessage } from "../drizzle/schema.ts";

interface ProcessedItem {
  outgoing: OutgoingMessage
  id: string
  conversation: string
}

export type { ProcessedItem }
