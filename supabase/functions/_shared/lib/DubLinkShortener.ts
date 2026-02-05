import { Dub } from 'dub'

const dub = new Dub({ token: Deno.env.get('DUB_API_KEY')! })

const detectLinksToShorten = (message: string): string[] => {
  if (!message) return []

  const urlMatches = message.match(/https:\/\/[^\s]+/g) || []

  // Clean up URLs (remove trailing punctuation)
  const matches = urlMatches.map((url) => url.replace(/[.,;:!?)]+$/, ''))

  // Filter out already shortened URLs (bit.ly, dub.sh, etc.)
  const shortenerDomains = ['bit.ly', 'dub.sh', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'go.outliermedia.org']
  const filteredMatches = matches.filter((url) => {
    const lowerUrl = url.toLowerCase()
    return !shortenerDomains.some((domain) => lowerUrl.includes(`https://${domain}/`))
  })

  return [...new Set(filteredMatches)]
}

const shortenLinksInMessage = async (message: string, id: number): Promise<[string, boolean]> => {
  try {
    // Detect URLs in the message
    const urls = detectLinksToShorten(message)
    console.log(`Found ${urls.length} URLs in the message: ${message}`)
    if (urls.length === 0) return [message, false]

    const tagName = Deno.env.get('DUB_TAG_NAME')
    if (!tagName) {
      console.error('DUB_TAG_NAME environment variable is not set')
      return [message, false]
    }

    const linksResponse = await dub.links.list({ tagNames: [tagName] })
    const existingLinks = linksResponse.result

    // Find URLs that don't have shortened links yet
    const urlsToCreate = urls.filter((url) => !existingLinks.some((link) => link.url === url))

    // Create new shortened links in bulk
    // @ts-ignore - LinkSchema is not exported
    let newLinks = []
    if (urlsToCreate.length > 0) {
      const bulkCreatePayload = urlsToCreate.map((url) => ({ url, tagNames: [tagName] }))
      newLinks = await dub.links.createMany(bulkCreatePayload)
      console.log(`Created ${newLinks.length} new shortened links in bulk. Data: ${JSON.stringify(newLinks)}`)
    }

    // @ts-ignore - LinkSchema is not exported
    const allLinks = [...existingLinks, ...newLinks]

    // Replace URLs in the message with their shortened versions by processing from longest to shortest
    // This prevents issues where a shorter URL is a prefix of a longer URL
    let processedMessage = message

    // Sort URLs by length (longest first) to avoid prefix problems
    const sortedUrls = [...urls].sort((a, b) => b.length - a.length)

    for (const url of sortedUrls) {
      const link = allLinks.find((link) => link.url === url)
      if (link?.shortLink) {
        // Replace all occurrences with regex (not just the first one)
        const pattern = new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
        processedMessage = processedMessage.replace(pattern, link.shortLink)
        console.log(`Replaced URL '${url}' with shortened link '${link.shortLink}'`)
      }
    }

    console.log(`Processed message: ${processedMessage}`)
    return [processedMessage, true]
  } catch (error) {
    console.error(
      `Error in shortenLinksInMessage: ${error}. Stack: ${error.stack}. Message: ${message}, ID: ${id}`,
    )
  }
  return [message, false]
}

export default { shortenLinksInMessage }
