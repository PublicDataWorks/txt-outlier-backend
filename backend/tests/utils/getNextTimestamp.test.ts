import { assertEquals } from 'testing/asserts.ts'
import { describe, it } from 'testing/bdd.ts'
import dateUtils from '../../misc/DateUtils.ts'

describe('getNextTimestamp', () => {
  describe('given that the input is Monday before 10 a.m. EDT', () => {
    it('returns next Tuesday at 10 a.m. EDT', () => {
      const date = new Date('2022-12-05T13:00:00Z') // This is Monday 9 a.m. EDT
      const result = dateUtils.getNextTimestamp(date)

      assertEquals(result.getUTCDay(), 2)
      assertEquals(result.getUTCHours(), 10)
      assertEquals(result.toISOString(), '2022-12-06T10:00:00.000Z')
    })
  })

  describe('given that the input is Tuesday', () => {
    it('returns next Wednesday at 10 a.m. EDT', () => {
      const date = new Date('2022-12-06T15:00:00Z') // This is Tuesday 10 a.m. EDT
      const result = dateUtils.getNextTimestamp(date)

      assertEquals(result.getUTCDay(), 3)
      assertEquals(result.getUTCHours(), 10)
      assertEquals(result.toISOString(), '2022-12-07T10:00:00.000Z')
    })
  })

  describe('given that the input is Friday after 10 a.m. EDT', () => {
    it('returns next Monday at 10 a.m. EDT', () => {
      const date = new Date('2022-12-09T15:00:00Z') // This is Friday 11 a.m. EDT
      const result = dateUtils.getNextTimestamp(date)

      assertEquals(result.getUTCDay(), 2)
      assertEquals(result.getUTCHours(), 10)
      assertEquals(result.toISOString(), '2022-12-13T10:00:00.000Z')
    })
  })

  describe('given that the input is Saturday', () => {
    it('returns next Monday at 10 a.m. EDT', () => {
      const date = new Date('2022-12-10T15:00:00Z') // This is Saturday 10 a.m. EDT
      const result = dateUtils.getNextTimestamp(date)

      assertEquals(result.getUTCDay(), 2)
      assertEquals(result.getUTCHours(), 10)
      assertEquals(result.toISOString(), '2022-12-13T10:00:00.000Z')
    })
  })
})
