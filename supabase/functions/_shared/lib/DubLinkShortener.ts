import { Dub } from 'dub'

const dub = new Dub({ token: Deno.env.get('DUB_API_KEY')! })

const ensureBroadcastTagExists = async (tagName: string) => {
  try {
    const existingTags = await dub.tags.list({ search: tagName })
    const tagExists = existingTags.some((tag) => tag.name === tagName)

    if (!tagExists) {
      try {
        await dub.tags.create({ name: tagName })
        console.log(`Created tag '${tagName}'`)
      } catch (createError) {
        // Handle ResponseValidationError - the tag may have been created successfully
        // despite the SDK validation error due to schema mismatch
        if (createError?.message?.includes('Response validation failed') ||
            createError?.constructor?.name === 'ResponseValidationError') {
          console.warn(
            `Tag creation returned validation error (likely SDK/API schema mismatch), verifying if tag was created: ${createError.message}`
          )

          // Verify if the tag was actually created
          const verifyTags = await dub.tags.list({ search: tagName })
          const tagNowExists = verifyTags.some((tag) => tag.name === tagName)

          if (tagNowExists) {
            console.log(`Tag '${tagName}' was created successfully despite validation error`)
          } else {
            // Tag creation genuinely failed
            throw createError
          }
        } else {
          // Different error - rethrow
          throw createError
        }
      }
    } else {
      console.log(`Tag '${tagName}' already exists`)
    }
  } catch (error) {
    // If tag operations fail completely, log the error but don't fail the entire link shortening
    console.error(
      `Error in ensureBroadcastTagExists for tag '${tagName}': ${error.message}. Stack: ${error.stack}. Continuing without tag.`
    )
    // We'll continue without the tag - links can still be created
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

    // Try to ensure tag exists (will not throw if it fails)
    await ensureBroadcastTagExists(tagName)

    // Try to get existing links with this tag
    let existingLinks = []
    try {
      const linksResponse = await dub.links.list({ tagNames: [tagName] })
      existingLinks = linksResponse.result
    } catch (listError) {
      console.warn(`Could not list links by tag '${tagName}': ${listError.message}. Will create all links as new.`)
    }

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
