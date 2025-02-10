import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'
import DateUtils from '../_shared/misc/DateUtils.ts'
import { dateToCron } from '../_shared/scheduledcron/helpers.ts'

describe('DateUtils', () => {
  describe('advance', () => {
    it('should advance time by milliseconds', () => {
      const now = new Date()
      const result = DateUtils.advance(1000) // advance 1 second

      // Allow small difference due to execution time
      const diff = result.getTime() - now.getTime()
      assertEquals(diff >= 1000 && diff < 1100, true, 'Should advance approximately 1 second')
    })
  })

  describe('diffInMinutes', () => {
    it('should calculate positive difference in minutes', () => {
      const now = new Date()
      const future = new Date(now.getTime() + 30 * 60 * 1000) // 30 minutes in future

      const result = DateUtils.diffInMinutes(future)
      assertEquals(Math.floor(result), 30, 'Should be approximately 30 minutes')
    })

    it('should calculate negative difference in minutes', () => {
      const now = new Date()
      const past = new Date(now.getTime() - 30 * 60 * 1000) // 30 minutes in past

      const result = DateUtils.diffInMinutes(past)
      assertEquals(Math.floor(result), -30, 'Should be approximately -30 minutes')
    })
  })

  describe('getNextTimestamp', () => {
    it('should get next Tuesday from Sunday', () => {
      const sunday = new Date('2024-03-17T10:00:00') // A Sunday
      const result = DateUtils.getNextTimestamp(sunday)
      assertEquals(result.toISOString(), '2024-03-19T10:00:00.000Z', 'Should be next Tuesday')
    })

    it('should get next Wednesday from Monday', () => {
      const monday = new Date('2024-03-18T10:00:00') // A Monday
      const result = DateUtils.getNextTimestamp(monday)
      assertEquals(result.toISOString(), '2024-03-19T10:00:00.000Z', 'Should be next Tuesday')
    })

    it('should get next Wednesday from Tuesday', () => {
      const tuesday = new Date('2024-03-19T10:00:00') // A Tuesday
      const result = DateUtils.getNextTimestamp(tuesday)
      assertEquals(result.toISOString(), '2024-03-20T10:00:00.000Z', 'Should be next Wednesday')
    })

    it('should get next Thursday from Wednesday', () => {
      const wednesday = new Date('2024-03-20T10:00:00') // A Wednesday
      const result = DateUtils.getNextTimestamp(wednesday)
      assertEquals(result.toISOString(), '2024-03-21T10:00:00.000Z', 'Should be next Thursday')
    })

    it('should get next Tuesday from Thursday', () => {
      const thursday = new Date('2024-03-21T10:00:00') // A Thursday
      const result = DateUtils.getNextTimestamp(thursday)
      assertEquals(result.toISOString(), '2024-03-26T10:00:00.000Z', 'Should be next Tuesday')
    })

    it('should get next Tuesday from Friday', () => {
      const friday = new Date('2024-03-22T10:00:00') // A Friday
      const result = DateUtils.getNextTimestamp(friday)
      assertEquals(result.toISOString(), '2024-03-26T10:00:00.000Z', 'Should be next Tuesday')
    })

    it('should get next Tuesday from Saturday', () => {
      const saturday = new Date('2024-03-23T10:00:00') // A Saturday
      const result = DateUtils.getNextTimestamp(saturday)
      assertEquals(result.toISOString(), '2024-03-26T10:00:00.000Z', 'Should be next Tuesday')
    })

    it('should reset minutes to zero', () => {
      const dateWithMinutes = new Date('2024-03-19T10:30:00') // Tuesday with 30 minutes
      const result = DateUtils.getNextTimestamp(dateWithMinutes)
      assertEquals(result.getMinutes(), 0, 'Minutes should be reset to 0')
    })
  })
})

describe('dateToCron', () => {
  it('should convert date to cron expression', () => {
    const testCases = [
      {
        date: new Date('2024-03-19T14:30:00'), // Tuesday, March 19, 2024, 14:30
        expected: '30 14 19 3 2',
      },
      {
        date: new Date('2024-01-01T00:00:00'), // Monday, January 1, 2024, 00:00
        expected: '0 0 1 1 1',
      },
      {
        date: new Date('2024-12-31T23:59:00'), // Tuesday, December 31, 2024, 23:59
        expected: '59 23 31 12 2',
      },
      {
        date: new Date('2024-02-29T12:15:00'), // Thursday, February 29, 2024 (leap year), 12:15
        expected: '15 12 29 2 4',
      },
      {
        date: new Date('2024-03-24T00:30:00'), // Sunday, March 24, 2024, 00:30
        expected: '30 0 24 3 0',
      },
    ]

    testCases.forEach(({ date, expected }) => {
      const result = dateToCron(date)
      assertEquals(
        result,
        expected,
        `Date ${date.toISOString()} should convert to cron expression "${expected}"`,
      )
    })
  })

  it('should handle UTC dates correctly', () => {
    // Create a specific UTC date
    const utcDate = new Date(Date.UTC(2024, 2, 19, 14, 30)) // March 19, 2024, 14:30 UTC
    const result = dateToCron(utcDate)

    assertEquals(result, '30 14 19 3 2', 'Should handle UTC date correctly')
  })

  it('should handle month conversion correctly (0-based to 1-based)', () => {
    const january = new Date('2024-01-01T00:00:00')
    const december = new Date('2024-12-01T00:00:00')

    assertEquals(dateToCron(january).split(' ')[3], '1', 'January should be 1')
    assertEquals(dateToCron(december).split(' ')[3], '12', 'December should be 12')
  })

  it('should handle day of week correctly (0-6, Sunday-Saturday)', () => {
    const testDays = [
      { date: new Date('2024-03-24T00:00:00'), day: '0', name: 'Sunday' },
      { date: new Date('2024-03-25T00:00:00'), day: '1', name: 'Monday' },
      { date: new Date('2024-03-26T00:00:00'), day: '2', name: 'Tuesday' },
      { date: new Date('2024-03-27T00:00:00'), day: '3', name: 'Wednesday' },
      { date: new Date('2024-03-28T00:00:00'), day: '4', name: 'Thursday' },
      { date: new Date('2024-03-29T00:00:00'), day: '5', name: 'Friday' },
      { date: new Date('2024-03-30T00:00:00'), day: '6', name: 'Saturday' },
    ]

    testDays.forEach(({ date, day, name }) => {
      const result = dateToCron(date).split(' ')[4]
      assertEquals(result, day, `${name} should be ${day}`)
    })
  })
})
