import { formatInTimeZone, toDate } from 'date-fns-tz'
import { addDays } from 'date-fns'

import supabase from '../lib/supabase.ts'
import { desc, eq } from 'drizzle-orm'
import { broadcastSettings } from '../drizzle/schema.ts'

const DETROIT_TIMEZONE = 'America/Detroit'

const advance = (milis: number): Date => {
  const date = new Date()
  date.setMilliseconds(date.getMilliseconds() + milis)
  return date
}

const diffInMinutes = (runAt: Date): number => {
  const now = new Date()
  return (runAt.getTime() - now.getTime()) / (1000 * 60)
}

const calculateNextScheduledTime = async (): Promise<number | null> => {
  const [activeSetting] = await supabase
    .select()
    .from(broadcastSettings)
    .where(eq(broadcastSettings.active, true))
    .orderBy(desc(broadcastSettings.id))
    .limit(1)

  if (!activeSetting) return null

  // Get current Detroit time components
  const now = new Date()
  const detroitDateTime = formatInTimeZone(now, DETROIT_TIMEZONE, 'yyyy-MM-dd HH:mm eee')
  const [currentDateDetroit, currentDetroitTime, rawDay] = detroitDateTime.split(' ')
  const currentDetroitDay = rawDay.toLowerCase()

  // Create schedule array with non-null times
  const schedule = Object.entries({
    mon: activeSetting.mon,
    tue: activeSetting.tue,
    wed: activeSetting.wed,
    thu: activeSetting.thu,
    fri: activeSetting.fri,
    sat: activeSetting.sat,
    sun: activeSetting.sun,
  })
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([day, time]) => ({ day, time }))

  // Get ordered days starting from current day
  const dayOrder = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const currentDayIndex = dayOrder.indexOf(currentDetroitDay)
  const orderedDays = [
    ...dayOrder.slice(currentDayIndex),
    ...dayOrder.slice(0, currentDayIndex),
  ]

  // Find next scheduled time
  let daysToAdd = 0
  let scheduledTime: string | null = null

  for (const day of orderedDays) {
    const scheduleForDay = schedule.find((s) => s.day === day)
    if (!scheduleForDay) {
      daysToAdd++
      continue
    }

    if (day === currentDetroitDay && scheduleForDay.time > currentDetroitTime) {
      scheduledTime = scheduleForDay.time
      break
    } else if (day !== currentDetroitDay) {
      scheduledTime = scheduleForDay.time
      break
    }
    daysToAdd++
  }

  if (!scheduledTime) return null

  // Convert Detroit time to UTC
  const detroitString = `${currentDateDetroit} ${scheduledTime}`
  const targetDate = toDate(detroitString, { timeZone: DETROIT_TIMEZONE })
  const finalDate = addDays(targetDate, daysToAdd)

  return Math.floor(finalDate.getTime() / 1000)
}

export default { advance, diffInMinutes, calculateNextScheduledTime }
