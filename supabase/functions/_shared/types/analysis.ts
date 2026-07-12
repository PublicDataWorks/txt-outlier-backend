export type TranscriptMessage = {
  body: string
  direction: 'inbound' | 'outbound'
  timestamp: string
  from: string
  to: string
}

export type AnalysisResult = {
  tag: string
  secondaryTags: string[]
  summary: string
  supportingQuote: string
  unmetDemand: boolean
  unmetDemandReason: string | null
  confidence: number
}
