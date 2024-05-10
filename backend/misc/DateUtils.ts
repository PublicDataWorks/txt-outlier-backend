const advance = (milis: number): Date => {
  const date = new Date()
  date.setMilliseconds(date.getMilliseconds() + milis)
  return date
}

const diffInMinutes = (runAt: Date): number => {
  const now = new Date()
  return (runAt.getTime() - now.getTime()) / (1000 * 60)
}

const getNextTimestamp = (date = new Date()) => {
  const now = new Date(date)
  const day = now.getUTCDay()

  let nextDay
  if (day === 1 || day === 2) {
    // If it's Monday, Tuesday, or it's Wednesday and it's before 10 a.m. EDT
    nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (3 - day), 14, 0, 0))
  } else if (day === 3 || day === 4) {
    // If it's Wednesday, Thursday, or it's Friday and it's before 10 a.m. EDT
    nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (5 - day), 14, 0, 0))
  } else {
    // If it's Friday after 10 a.m. EDT, or it's Saturday or Sunday
    nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (8 - day), 14, 0, 0))
  }
  return nextDay
}

export default { advance, diffInMinutes, getNextTimestamp }
