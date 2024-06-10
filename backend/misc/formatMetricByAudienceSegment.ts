export function formatMetricByAudienceSegment(metrics) {
  let metricReport = ''
  metrics.forEach((metric) => {
    metricReport += `| - ${metric.name.padEnd(28)} | ${metric.count.toString().padEnd(4)} |\n`
  })
  return metricReport ? `${metricReport.trim()}\n` : ''
}
