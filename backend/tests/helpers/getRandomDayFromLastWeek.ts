export function getRandomDayFromLastWeek() {
  const currentDate = new Date()
  const currentDay = currentDate.getDay()
  const currentDayOfWeek = currentDay === 0 ? 7 : currentDay // Adjust Sunday from 0 to 7

  // Calculate the previous Monday (7 days back)
  const previousMonday = new Date(currentDate)
  previousMonday.setDate(currentDate.getDate() - currentDayOfWeek - 6)

  // Generate a random number between 0 and 6 (inclusive)
  const randomOffset = 1 + Math.floor(Math.random() * 5)

  // Calculate the random day within the previous week
  const randomDate = new Date(previousMonday)
  randomDate.setDate(previousMonday.getDate() + randomOffset)

  return randomDate.toISOString()
}
