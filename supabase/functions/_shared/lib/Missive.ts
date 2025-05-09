import { decodeHex } from 'encoding/hex.ts'
import UnauthorizedError from '../exception/UnauthorizedError.ts'
import Sentry from './Sentry.ts'

const CREATE_MESSAGE_URL = 'https://public.missiveapp.com/v1/drafts'
const GET_MESSAGE_URL = 'https://public.missiveapp.com/v1/messages/'
const CREATE_POST_URL = 'https://public.missiveapp.com/v1/posts'
const GET_LABELS_URL = 'https://public.missiveapp.com/v1/shared_labels'
const BROADCAST_PHONE_NUMBER = Deno.env.get('BROADCAST_SOURCE_PHONE_NUMBER')!
const MISSIVE_ORGANIZATION_ID = Deno.env.get('MISSIVE_ORGANIZATION_ID')!
const MISSIVE_SECRET_BROADCAST_SECOND_MESSAGES = Deno.env.get('MISSIVE_SECRET_BROADCAST_SECOND_MESSAGES')!
const MISSIVE_SECRET_BROADCAST_FIRST_MESSAGES = Deno.env.get('MISSIVE_SECRET_BROADCAST_FIRST_MESSAGES')!
const MISSIVE_SECRET_NON_BROADCAST = Deno.env.get('MISSIVE_SECRET_NON_BROADCAST')!

const sendMessage = async (message: string, toPhone: string, isSecond: boolean, sharedLabelIds: string[]) => {
  const startTime = Date.now()
  // deno-lint-ignore no-explicit-any
  const body: any = {
    drafts: {
      'body': message,
      'to_fields': [
        { 'phone_number': toPhone },
      ],
      'from_field': {
        'phone_number': BROADCAST_PHONE_NUMBER,
        'type': 'twilio',
      },
      'send': true, // Send right away
    },
  }

  if (sharedLabelIds.length > 0) {
    body.drafts.add_shared_labels = sharedLabelIds
    body.drafts.organization = MISSIVE_ORGANIZATION_ID
  }
  const apiToken = isSecond ? MISSIVE_SECRET_BROADCAST_SECOND_MESSAGES : MISSIVE_SECRET_BROADCAST_FIRST_MESSAGES
  const response = await fetch(CREATE_MESSAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`,
    },
    body: JSON.stringify(body),
  })
  const elapsedTime = Date.now() - startTime
  if (elapsedTime > 10000) {
    Sentry.captureException(
      `Missive DRAFT API call took too long. Elapsed time: ${elapsedTime}ms. Message: ${message}. Phone: ${toPhone}. Is second: ${isSecond}`,
    )
  }
  return response
}

const createPost = async (conversationId: string, postBody: string, sharedLabelId?: string) => {
  // deno-lint-ignore no-explicit-any
  const postData: any = {
    posts: {
      'username': 'TXT Outlier',
      notification: {
        title: 'System',
        body: `Admins action`,
      },
      text: postBody,
      conversation: conversationId,
    },
  }

  if (sharedLabelId) {
    postData.posts.add_shared_labels = [sharedLabelId]
    postData.posts.close = true
    postData.posts.reopen = false
    postData.posts.organization = MISSIVE_ORGANIZATION_ID
  }

  return await fetch(CREATE_POST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MISSIVE_SECRET_NON_BROADCAST}`,
    },
    body: JSON.stringify(postData),
  })
}

const getMissiveMessage = async (id: string) => {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${MISSIVE_SECRET_NON_BROADCAST}`,
  }
  const url = `${GET_MESSAGE_URL}${id}`
  return await fetch(url, { method: 'GET', headers: headers })
}

// deno-lint-ignore no-explicit-any
const verifySignature = async (req: Request, requestBody: any): Promise<boolean> => {
  if (Deno.env.get('IS_TESTING')) return true

  const headerSig = req.headers.get('x-hook-signature')
  if (!headerSig) {
    throw new UnauthorizedError('Missing signature header')
  }

  const hmacSecret = Deno.env.get('HMAC_SECRET')
  if (!hmacSecret) {
    throw new Error('HMAC_SECRET is not defined in environment variables')
  }
  const keyPrefix = 'sha256='
  const cleanedHeaderSig = headerSig.startsWith(keyPrefix) ? headerSig.slice(keyPrefix.length) : headerSig
  const encoder = new TextEncoder()
  const data = encoder.encode(JSON.stringify(requestBody))
  const keyBuf = encoder.encode(hmacSecret)

  const key = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )

  const receivedSignature = decodeHex(cleanedHeaderSig)

  return await crypto.subtle.verify(
    { name: 'HMAC', hash: 'SHA-256' },
    key,
    receivedSignature,
    data.buffer,
  )
}

const createLabel = async (labelName: string) => {
  try {
    const response = await fetch(GET_LABELS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISSIVE_SECRET_NON_BROADCAST}`,
      },
      body: JSON.stringify({
        shared_labels: {
          name: labelName,
          organization: MISSIVE_ORGANIZATION_ID,
        },
      }),
    })

    if (response.ok) {
      const data = await response.json()
      const label = data.shared_labels[0] || data.shared_labels
      return label.id
    }
  } catch (error) {
    console.error(`Error creating label: ${error.message}`)
  }
}

const findLabelByName = async (labelName: string) => {
  try {
    const limit = 50 // Max is 200
    let offset = 0

    // Continue fetching pages until we find the label or reach an empty page
    // Limit to 40 iterations (40*50 = 2000 labels max)
    let iteration = 0
    while (iteration < 40) {
      iteration++
      const response = await fetch(`${GET_LABELS_URL}?limit=${limit}&offset=${offset}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MISSIVE_SECRET_NON_BROADCAST}`,
        },
      })

      if (!response.ok) {
        console.error(`Error fetching labels (status ${response.status})`)
        break
      }

      const data = await response.json()
      if (!data.shared_labels || data.shared_labels.length === 0) {
        // We've reached the end of the results
        break
      }

      const foundLabel = data.shared_labels.find(
        // deno-lint-ignore no-explicit-any
        (label: any) => label.name.toLowerCase() === labelName.toLowerCase(),
      )

      if (foundLabel) {
        return foundLabel.id
      }

      offset += limit
    }

    // Label wasn't found in any page
    return
  } catch (error) {
    console.error(`Error finding label: ${error.message}`)
  }
}

export default {
  sendMessage,
  createPost,
  verifySignature,
  getMissiveMessage,
  createLabel,
  findLabelByName,
  CREATE_MESSAGE_URL,
} as const
