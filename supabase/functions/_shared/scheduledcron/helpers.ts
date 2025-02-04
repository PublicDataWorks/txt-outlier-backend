const escapeLiteral = (val: boolean | string | null): string => {
  if (val == null) {
    return 'NULL'
  }
  if (typeof val === 'number') {
    return `'${val}'`
  }
  if (typeof val === 'boolean') {
    return `'${val.toString()}'`
  }

  if (Array.isArray(val)) {
    const vals = val.map(escapeLiteral)
    return '(' + vals.join(', ') + ')'
  }

  const backslash = val.indexOf('\\') !== -1
  const prefix = backslash ? 'E' : ''
  val = val.replace(/'/g, "''")
  val = val.replace(/\\/g, '\\\\')

  return prefix + "'" + val + "'"
}


const dateToCron = (date: Date) => {
  const minutes = date.getMinutes()
  const hours = date.getHours()
  const days = date.getDate()
  const months = date.getMonth() + 1
  const dayOfWeek = date.getDay()

  return `${minutes} ${hours} ${days} ${months} ${dayOfWeek}`
}

export { escapeLiteral, dateToCron }
