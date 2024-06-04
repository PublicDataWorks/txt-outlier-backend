export function formatConversationForReport(conversations) {
  let conversationReport = ''
  conversations.forEach((result) => {
    conversationReport += `| - ${result.label_name.padEnd(28)} | ${result.count.toString().padEnd(4)} |\n`
  })
  return conversationReport ? `${conversationReport.trim()}\n` : ''
}
