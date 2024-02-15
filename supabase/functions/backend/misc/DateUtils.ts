const advance = (milis: number): Date => {
  const date = new Date()
  date.setMilliseconds(date.getMilliseconds() + milis)
  return date
}

export default { advance }
