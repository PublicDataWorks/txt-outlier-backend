import { assertEquals } from 'testing/asserts.ts'
import { describe, it } from 'testing/bdd.ts'
import dateUtils from '../../misc/DateUtils.ts'

describe('getCurrentDateFormattedForWeeklyReport', () => {
  // Test for a specific date
  it('should return the formatted date for a specific date', () => {
    assertEquals(dateUtils.getCurrentDateFormattedForWeeklyReport(new Date('2024-05-22T00:00:00Z')), 'May 22, 2024')
  })

  // Test for another specific date
  it('should return the formatted date for another specific date', () => {
    assertEquals(
      dateUtils.getCurrentDateFormattedForWeeklyReport(new Date('2023-12-31T00:00:00Z')),
      'December 31, 2023',
    )
  })

  // Test for the current date (this test will pass on the actual current date)
})
