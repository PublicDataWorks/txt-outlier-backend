import { Dub } from 'dub'

const dub = new Dub({ token: Deno.env.get('DUB_API_KEY')! })

const ensureBroadcastTagExists = async (tagName: string) => {
  const existingTags = await dub.tags.list({ search: tagName })
  const tagExists = existingTags.some((tag) => tag.name === tagName)

  if (!tagExists) {
    await dub.tags.create({ name: tagName })
    console.log(`Created tag '${tagName}'`)
  } else {
    console.log(`Tag '${tagName}' already exists`)
  }
}

const detectLinksToShorten = (message: string): string[] => {
  if (!message) return []

  const urlMatches = message.match(/https:\/\/[^\s]+/g) || []

  // Clean up URLs (remove trailing punctuation)
  const matches = urlMatches.map((url) => url.replace(/[.,;:!?)]+$/, ''))

  // Filter out already shortened URLs (bit.ly, dub.sh, etc.)
  const filteredMatches = matches.filter((url) => {
    const lowerUrl = url.toLowerCase()
    return !lowerUrl.includes('//bit.ly/') &&
      !lowerUrl.includes('https://dub.sh/') &&
      !lowerUrl.includes('https://tinyurl.com/') &&
      !lowerUrl.includes('https://goo.gl/')
  })

  return [...new Set(filteredMatches)]
}

const shortenLinksInMessage = async (message: string, id: number, isBroadcast = true): Promise<[string, boolean]> => {
  try {
    // Detect URLs in the message
    const urls = detectLinksToShorten(message)
    console.log(`Found ${urls.length} URLs in the message: ${message}`)
    if (urls.length === 0) return [message, false]
    let tagName = `campaign-${id}`
    if (isBroadcast) {
      tagName = `broadcast-${id}`
    }

    await ensureBroadcastTagExists(tagName)

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
      `Error in shortenLinksInMessage: ${error.message}. Stack: ${error.stack}. Message: ${message}, ID: ${id}, isBroadcast: ${isBroadcast}`,
    )
  }
  return [message, false]
}

export default { shortenLinksInMessage }
