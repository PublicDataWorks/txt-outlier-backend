const intervalToString = (interval: string) => {
  const [hours, minutes, seconds] = interval.split(':').map(Number)
  let result = ''

  if (hours > 0) result += `${hours} ${hours === 1 ? 'hour' : 'hours'}, `
  if (minutes > 0) result += `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, `
  if (seconds > 0) result += `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`

  if (result === '') {
    return 'Invalid interval format'
  } else {
    result = result.trim()
    if (result.endsWith(',')) {
      result = result.slice(0, -1)
    }
    return result
  }
}

const removeExtraSpaces = (str: string): string => {
  const preserveEdgeSpaces = str.replace(/^(\s+)|\s+$/g, (match) => match.length > 1 ? ' ' : match)

  return preserveEdgeSpaces
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/^\s|\s$/g, (match) => match.length > 1 ? ' ' : match)
}

const sleep = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export { intervalToString, removeExtraSpaces, sleep }
