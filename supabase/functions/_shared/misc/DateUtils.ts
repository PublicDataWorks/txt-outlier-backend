import supabase from '../lib/supabase.ts'
import { desc, eq } from 'drizzle-orm'
import { broadcastSettings } from '../drizzle/schema.ts'

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

  const utcNow = new Date()

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit',
    weekday: 'short',
  })

  const currentTime = timeFormatter.format(utcNow)
  const currentDay = dayFormatter.format(utcNow).toLowerCase()

  type ScheduleDay = { day: string; time: string | null }
  const schedule: ScheduleDay[] = [
    { day: 'mon', time: activeSetting.mon?.toString() ?? null },
    { day: 'tue', time: activeSetting.tue?.toString() ?? null },
    { day: 'wed', time: activeSetting.wed?.toString() ?? null },
    { day: 'thu', time: activeSetting.thu?.toString() ?? null },
    { day: 'fri', time: activeSetting.fri?.toString() ?? null },
    { day: 'sat', time: activeSetting.sat?.toString() ?? null },
    { day: 'sun', time: activeSetting.sun?.toString() ?? null },
  ].filter((s): s is { day: string; time: string } => s.time !== null)

  if (schedule.length === 0) return null

  const dayOrder = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
  const currentDayIndex = dayOrder.indexOf(currentDay as typeof dayOrder[number])
  if (currentDayIndex === -1) throw new Error(`Invalid day: ${currentDay}`)

  const orderedDays = [
    ...dayOrder.slice(currentDayIndex),
    ...dayOrder.slice(0, currentDayIndex),
  ]

  // Create Detroit date for calculations
  const detroitNow = new Date(utcNow.toLocaleString('en-US', { timeZone: 'America/Detroit' }))
  let found = false

  for (const day of orderedDays) {
    const scheduleForDay = schedule.find((s) => s.day === day)
    if (!scheduleForDay) continue

    if (day === currentDay) {
      if (scheduleForDay.time! > currentTime) {
        const [hours, minutes] = scheduleForDay.time!.split(':').map(Number)
        detroitNow.setHours(hours, minutes, 0, 0)
        found = true
        break
      }
    } else {
      detroitNow.setDate(detroitNow.getDate() + 1)
      const [hours, minutes] = scheduleForDay.time!.split(':').map(Number)
      detroitNow.setHours(hours, minutes, 0, 0)
      found = true
      break
    }
  }

  if (!found) return null

  // Convert Detroit time to UTC timestamp
  return Math.floor(
    new Date(detroitNow.toLocaleString('en-US', { timeZone: 'UTC' })).getTime() / 1000,
  )
}

export default { advance, diffInMinutes, calculateNextScheduledTime }
