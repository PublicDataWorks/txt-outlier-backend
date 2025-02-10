import { addDays, getDay, setMinutes } from 'date-fns'

const advance = (milis: number): Date => {
  const date = new Date()
  date.setMilliseconds(date.getMilliseconds() + milis)
  return date
}

const diffInMinutes = (runAt: Date): number => {
  const now = new Date()
  return (runAt.getTime() - now.getTime()) / (1000 * 60)
}

const getNextTimestamp = (date: Date): Date => {
  const day = getDay(date)

  // Calculate the number of days to add to reach the next Tuesday, Wednesday, or Thursday at 10 AM
  let daysToAdd = 0
  switch (day) {
    case 0: // Sunday
      daysToAdd = 2
      break
    case 1: // Monday
    case 2: // Tuesday
    case 3: // Wednesday
      daysToAdd = 1
      break
    case 4: // Thursday
      daysToAdd = 5
      break
    case 5: // Friday
      daysToAdd = 4
      break
    case 6: // Saturday
      daysToAdd = 3
      break
  }

  let nextDay = addDays(date, daysToAdd)
  nextDay = setMinutes(nextDay, 0)
  return nextDay
}

export default { advance, diffInMinutes, getNextTimestamp }
