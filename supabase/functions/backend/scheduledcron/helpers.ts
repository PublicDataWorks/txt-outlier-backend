// deno-lint-ignore no-explicit-any
export const escapeLiteral = (val: any): string => {
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
