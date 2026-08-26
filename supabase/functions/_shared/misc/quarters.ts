// Quarter-boundary helpers for the newsroom-facing "Nth this quarter" ordinal.
//
// Kept in their own module, free of any database import, so the boundary decision can be unit-tested
// directly. The bug these exist to prevent lived inside a DB-coupled counting function, where the only way
// to reach it was a full queue run with OpenAI and Slack mocked - so nothing tested it, and a backfill
// shipped hundreds of Slack posts claiming an ordinal for conversations from a previous year.

// Injectable `now` so tests can pin a date instead of depending on when the suite happens to run.
export const startOfCurrentQuarter = (now: Date = new Date()): string => {
  const quarterMonth = Math.floor(now.getUTCMonth() / 3) * 3
  return new Date(Date.UTC(now.getUTCFullYear(), quarterMonth, 1)).toISOString()
}

// Whether a conversation's own activity timestamp falls inside the current quarter. An absent or
// unparseable timestamp is not in the quarter: the ordinal asserts a fact about this conversation, and an
// unknown date cannot support that claim.
export const isInCurrentQuarter = (timestamp: string | null, now: Date = new Date()): boolean => {
  if (!timestamp) return false
  const at = new Date(timestamp).getTime()
  if (Number.isNaN(at)) return false
  return at >= new Date(startOfCurrentQuarter(now)).getTime()
}
