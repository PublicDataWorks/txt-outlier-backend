import { addDays, getDay, setHours, setMinutes } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const advance = (milis: number): Date => {
  const date = new Date()
  date.setMilliseconds(date.getMilliseconds() + milis)
  return date
}

const diffInMinutes = (runAt: Date): number => {
  const now = new Date()
  return (runAt.getTime() - now.getTime()) / (1000 * 60)
}

const getNextTimestamp = (date: Date = new Date()): Date => {
  const timeZone = 'America/New_York' // EDT timezone
  //Any date input should be in UTC
  // Determine the current day of the week
  const edtTime = toZonedTime(date, timeZone)
  const day = getDay(edtTime)

  // Calculate the number of days to add to reach the next Monday, Wednesday, or Friday
  let daysToAdd = 0
  if (day === 0 || day === 2 || day === 4) { // Sunday, Tuesday, Thursday
    daysToAdd = 1 // Next day is Monday, Wednesday, Friday respectively
  } else if (day === 1 || day === 3 || day === 6) { // Monday, Wednesday, Sat
    daysToAdd = 2 // Next is Wednesday, Friday, Monday
  } else if (day === 5) { // Friday
    daysToAdd = 3 // Next is Monday
  }

  let nextDay = addDays(edtTime, daysToAdd)
  nextDay = setHours(nextDay, 10)
  nextDay = setMinutes(nextDay, 0)
  return nextDay
}

export default { advance, diffInMinutes, getNextTimestamp }
