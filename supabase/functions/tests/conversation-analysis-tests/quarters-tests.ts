import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

// No setup.ts import: these helpers touch no database, so the suite's Postgres bootstrap is not needed.
import { isInCurrentQuarter, startOfCurrentQuarter, startOfNextQuarter } from '../../_shared/misc/quarters.ts'

// Fixed "now" in Q3 2026 so these assertions don't depend on when the suite runs.
const NOW = new Date('2026-08-26T08:30:00.000Z')

describe('startOfCurrentQuarter', () => {
  it('snaps to the first instant of the containing quarter', () => {
    assertEquals(startOfCurrentQuarter(new Date('2026-01-01T00:00:00.000Z')), '2026-01-01T00:00:00.000Z')
    assertEquals(startOfCurrentQuarter(new Date('2026-03-31T23:59:59.999Z')), '2026-01-01T00:00:00.000Z')
    assertEquals(startOfCurrentQuarter(new Date('2026-04-01T00:00:00.000Z')), '2026-04-01T00:00:00.000Z')
    assertEquals(startOfCurrentQuarter(NOW), '2026-07-01T00:00:00.000Z')
    assertEquals(startOfCurrentQuarter(new Date('2026-12-31T23:59:59.999Z')), '2026-10-01T00:00:00.000Z')
  })
})

describe('startOfNextQuarter', () => {
  it('returns the first instant of the following quarter', () => {
    assertEquals(startOfNextQuarter(NOW), '2026-10-01T00:00:00.000Z')
    assertEquals(startOfNextQuarter(new Date('2026-01-15T00:00:00.000Z')), '2026-04-01T00:00:00.000Z')
  })

  it('rolls over the year from Q4', () => {
    assertEquals(startOfNextQuarter(new Date('2026-11-30T12:00:00.000Z')), '2027-01-01T00:00:00.000Z')
  })
})

describe('isInCurrentQuarter', () => {
  // The regression this module exists for: a backfill of historical threads had every Slack post claim an
  // "Nth this quarter" ordinal for conversations that closed a year or more earlier.
  it('rejects a conversation from a previous quarter or year', () => {
    assertEquals(isInCurrentQuarter('2025-01-17T12:00:00.000Z', NOW), false)
    assertEquals(isInCurrentQuarter('2026-06-30T23:59:59.999Z', NOW), false)
  })

  it('accepts a conversation inside the current quarter', () => {
    assertEquals(isInCurrentQuarter('2026-08-25T12:00:00.000Z', NOW), true)
  })

  it('treats the quarter boundary itself as inside the quarter', () => {
    assertEquals(isInCurrentQuarter('2026-07-01T00:00:00.000Z', NOW), true)
  })

  // The window is a real interval, not "recent enough". delivered_at comes from ingest, so clock skew or a
  // bad payload can put a message ahead of now; such a row would otherwise take an ordinal of its own and
  // inflate every genuine post for the rest of the quarter.
  it('rejects a timestamp in a later quarter', () => {
    assertEquals(isInCurrentQuarter('2026-10-01T00:00:00.000Z', NOW), false)
    assertEquals(isInCurrentQuarter('2026-09-30T23:59:59.999Z', NOW), true)
    assertEquals(isInCurrentQuarter('2027-03-01T00:00:00.000Z', NOW), false)
  })

  // An unknown date cannot support a claim about when this conversation happened. Before the fix the caller
  // fell back to the analysis row's created_at, which for a backfill is today - making a year-old
  // conversation count as current and seeding a non-zero base that every later post inherited.
  it('treats a missing or unparseable timestamp as not in the quarter', () => {
    assertEquals(isInCurrentQuarter(null, NOW), false)
    assertEquals(isInCurrentQuarter('', NOW), false)
    assertEquals(isInCurrentQuarter('not a date', NOW), false)
  })

  // Postgres renders timestamptz as "YYYY-MM-DD HH:MM:SS+00", not ISO-8601 with a T. A plain string
  // comparison against an ISO quarter start would sort ' ' before 'T' and drop a conversation sitting
  // exactly on the boundary, so the comparison goes through Date.
  it('accepts the postgres timestamptz rendering', () => {
    assertEquals(isInCurrentQuarter('2026-08-26 08:30:44.43955+00', NOW), true)
    assertEquals(isInCurrentQuarter('2026-07-01 00:00:00+00', NOW), true)
    assertEquals(isInCurrentQuarter('2025-01-17 12:00:00+00', NOW), false)
  })
})
