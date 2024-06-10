export const formatLookupHistory = (metrics) => {
  let lookupHistoryReport = ''
  metrics.forEach((metric: {status: string, count: number}) => {
    lookupHistoryReport += `| ${mapStatus(metric.status).padEnd(28)} | ${metric.count.toString().padEnd(5)} |\n`
  })
  
  return lookupHistoryReport ? `${lookupHistoryReport.trim()}\n` : ''
}

function toPascalCase(str) {
  return str
    .toLowerCase()               // Convert the string to lowercase
    .split(/[_\s]+/)             // Split by underscores or spaces
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize the first letter of each word
    .join(' ');                  // Join the words back with spaces
}

function mapStatus(rawStatus) {
  if (rawStatus === 'OK') {
    return 'No Tax Debt';
  } else {
    return toPascalCase(rawStatus);
  }
}