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

  // This regex matches URLs starting with http:// or https:// that have whitespace before and after,
  // or are at the start or end of the message
  const urlRegex = /(^|\s)(https?:\/\/[^\s]+)($|\s)/g

  const matches = []
  let match
  while ((match = urlRegex.exec(message)) !== null) {
    matches.push(match[2])
  }

  // Filter out already shortened URLs (bit.ly, dub.sh, etc.)
  const filteredMatches = matches.filter((url) => {
    // Check if the URL contains common shortener domains
    const lowerUrl = url.toLowerCase()
    return !lowerUrl.includes('//bit.ly/') &&
      !lowerUrl.includes('//dub.sh/') &&
      !lowerUrl.includes('//tinyurl.com/') &&
      !lowerUrl.includes('//goo.gl/')
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

    // Fetch all existing links for this broadcast
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
        // Create a safe regex that matches the exact URL and not parts of other URLs
        const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(escapedUrl, 'g')

        // Replace all occurrences of this URL in the message
        processedMessage = processedMessage.replace(regex, link.shortLink)
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

const cleanupUnusedLinks = async (
  broadcastId: number,
  firstMessage?: string,
  secondMessage?: string,
) => {
  try {
    // Collect all URLs from both messages
    const allUrls = new Set<string>()

    if (firstMessage) {
      const firstMessageUrls = detectLinksToShorten(firstMessage)
      firstMessageUrls.forEach((url) => allUrls.add(url))
    }

    if (secondMessage) {
      const secondMessageUrls = detectLinksToShorten(secondMessage)
      secondMessageUrls.forEach((url) => allUrls.add(url))
    }

    const urlsToKeep = [...allUrls]
    if (urlsToKeep.length === 0) {
      console.log('No URLs found in the messages. Skipping cleanup.')
      return
    }
    // Get existing links for this broadcast
    const tagName = `broadcast-${broadcastId}`
    const linksResponse = await dub.links.list({ tagNames: [tagName] })
    const existingLinks = linksResponse.result

    // Find links that should be deleted (not in either message)
    const linksToDelete = existingLinks.filter((link) => !urlsToKeep.includes(link.url))

    // Delete unused links in bulk
    if (linksToDelete.length > 0) {
      const linkIdsToDelete = linksToDelete.map((link) => link.id)
      await dub.links.deleteMany({ linkIds: linkIdsToDelete })
      console.log(
        `Deleted ${linkIdsToDelete.length} unused links for broadcast ${broadcastId}. Data: ${
          JSON.stringify(linkIdsToDelete)
        }`,
      )
    }
  } catch (error) {
    console.error(
      `Error in cleanupUnusedLinks: ${error.message}. Stack: ${error.stack}. Broadcast ID: ${broadcastId}, Messages: ${firstMessage}, ${secondMessage}`,
    )
  }
}

export default { shortenLinksInMessage, cleanupUnusedLinks }
