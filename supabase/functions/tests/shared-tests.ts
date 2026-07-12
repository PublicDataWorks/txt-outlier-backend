import { describe, it } from 'jsr:@std/testing/bdd'
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert'
import './setup.ts'
import DateUtils from '../_shared/misc/DateUtils.ts'
import { createBroadcastSetting } from './factories/broadcast-settings.ts'
import { formatInTimeZone } from 'date-fns-tz'

const DETROIT_TIMEZONE = 'America/Detroit'

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

  describe('calculateNextScheduledTime', { sanitizeOps: false, sanitizeResources: false }, () => {
    it('should return null when no active setting exists', async () => {
      const result = await DateUtils.calculateNextScheduledTime()
      assertEquals(result, null)
    })

    it('should return null when active setting has no schedules', async () => {
      await createBroadcastSetting({
        mon: null,
        tue: null,
        wed: null,
        thu: null,
        fri: null,
        sat: null,
        sun: null,
        active: true,
      })

      const result = await DateUtils.calculateNextScheduledTime()
      assertEquals(result, null)
    })

    it('should find next time on same day', async () => {
      const now = new Date()

      // Get later time in Detroit
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000)
      const laterDetroitDateTime = formatInTimeZone(twoHoursLater, DETROIT_TIMEZONE, 'yyyy-MM-dd HH:mm:ss eee')
      const [_, laterTimeDetroit, laterDay] = laterDetroitDateTime.split(' ')

      await createBroadcastSetting({
        [laterDay.toLowerCase()]: laterTimeDetroit,
        active: true,
      })

      const result = await DateUtils.calculateNextScheduledTime()
      assertNotEquals(result, null)
      const resultInDetroit = new Date(result! * 1000)
      const resultDetroitTime = formatInTimeZone(resultInDetroit, DETROIT_TIMEZONE, 'HH:mm:ss')

      assertEquals(resultDetroitTime, laterTimeDetroit)

      const resultDay = formatInTimeZone(resultInDetroit, DETROIT_TIMEZONE, 'eee').toLowerCase()
      assertEquals(resultDay, laterDay.toLowerCase())
    })

    it('should find next time on next day when all times today have passed', async () => {
      const now = new Date()
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      const nowInDetroit = formatInTimeZone(now, DETROIT_TIMEZONE, 'yyyy-MM-dd HH:mm:ss eee')
      const tomorrowInDetroit = formatInTimeZone(tomorrow, DETROIT_TIMEZONE, 'yyyy-MM-dd HH:mm:ss eee')
      const [_, __, todayDay] = nowInDetroit.split(' ')
      const [___, ____, tomorrowDay] = tomorrowInDetroit.split(' ')

      await createBroadcastSetting({
        [todayDay.toLowerCase()]: '00:00:00',
        [tomorrowDay.toLowerCase()]: '09:00:00',
        active: true,
      })

      const result = await DateUtils.calculateNextScheduledTime()
      assertNotEquals(result, null)
      const resultInDetroit = new Date(result! * 1000)
      const resultDetroitTime = formatInTimeZone(resultInDetroit, DETROIT_TIMEZONE, 'HH:mm:ss')

      assertEquals(resultDetroitTime, '09:00:00')
      const resultDay = formatInTimeZone(resultInDetroit, DETROIT_TIMEZONE, 'eee').toLowerCase()
      assertEquals(resultDay, tomorrowDay.toLowerCase())
    })

    it('should wrap around to next week when no remaining times this week', async () => {
      const now = new Date()
      const nowInDetroit = formatInTimeZone(now, DETROIT_TIMEZONE, 'yyyy-MM-dd HH:mm:ss eee')
      const [_, _currentTime, todayDay] = nowInDetroit.split(' ')

      // Get the day order and find yesterday's day
      const dayOrder = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
      const todayIndex = dayOrder.indexOf(todayDay.toLowerCase())
      const yesterdayIndex = (todayIndex - 1 + 7) % 7
      const yesterdayDay = dayOrder[yesterdayIndex]

      // Set time only for yesterday, forcing a wrap to next week
      await createBroadcastSetting({
        [yesterdayDay]: '09:00:00',
        active: true,
      })

      const result = await DateUtils.calculateNextScheduledTime()
      assertNotEquals(result, null)
      const resultInDetroit = new Date(result! * 1000)

      // Verify it's scheduled for yesterday's day next week
      const resultDay = formatInTimeZone(resultInDetroit, DETROIT_TIMEZONE, 'eee').toLowerCase()
      assertEquals(resultDay, yesterdayDay)

      // Verify the time component matches what we stored, accounting for possible DST change
      const resultTime = formatInTimeZone(resultInDetroit, DETROIT_TIMEZONE, 'HH:mm:ss')
      const originalTime = '09:00:00' // The time we set in the test

      // Check if the date range crosses a DST boundary
      const nowOffset = formatInTimeZone(now, DETROIT_TIMEZONE, 'xxx')
      const resultOffset = formatInTimeZone(resultInDetroit, DETROIT_TIMEZONE, 'xxx')
      const isDSTChange = nowOffset !== resultOffset

      if (isDSTChange) {
        // If there's a DST change, the hour may shift by 1
        const [originalHour, originalMinSec] = [originalTime.substring(0, 2), originalTime.substring(2)]
        const [resultHour, resultMinSec] = [resultTime.substring(0, 2), resultTime.substring(2)]

        assertEquals(resultMinSec, originalMinSec, 'Minutes and seconds should match')
        assert(
          Math.abs(parseInt(resultHour) - parseInt(originalHour)) === 1,
          `Expected hour to differ by 1 due to DST change, got ${resultHour} vs ${originalHour}`,
        )
      } else {
        // If no DST change, times should match exactly
        assertEquals(resultTime, originalTime)
      }
      const nowDate = new Date(formatInTimeZone(now, DETROIT_TIMEZONE, 'yyyy-MM-dd'))
      const resultDate = new Date(formatInTimeZone(resultInDetroit, DETROIT_TIMEZONE, 'yyyy-MM-dd'))
      const diffInDays = Math.round((resultDate.getTime() - nowDate.getTime()) / (24 * 60 * 60 * 1000))
      assertEquals(diffInDays, 6)
    })
  })
})
