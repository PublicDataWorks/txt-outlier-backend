import * as log from 'log'
import supabase from './supabase.ts'
import { lookupTemplate } from '../drizzle/schema.ts'
import { eq, or } from 'drizzle-orm'

export const isTesting = Deno.env.get('ENV') === 'testing'

const CREATE_MESSAGE_URL = 'https://public.missiveapp.com/v1/drafts'
const CREATE_POST_URL = 'https://public.missiveapp.com/v1/posts'
const GET_MESSAGE_URL = 'https://public.missiveapp.com/v1/messages/'

interface MissiveKey {
  name: string
  content: string
}

let missive_keys: MissiveKey[] = isTesting
  ? [
    { name: 'missive_secret', content: 'dummy_secret_content' },
    { name: 'missive_broadcast_use_secret', content: 'dummy_broadcast_content' },
  ]
  : []

if (!isTesting) {
  missive_keys = await supabase.select({ name: lookupTemplate.name, content: lookupTemplate.content }).from(
    lookupTemplate,
  ).where(or(eq(lookupTemplate.name, 'missive_secret'), eq(lookupTemplate.name, 'missive_broadcast_use_secret')))

  if (missive_keys.length !== 2) {
    throw new Error(`Expected exactly two Missive keys, but found ${missive_keys.length}.`)
  }
  const hasEmptyKey = missive_keys.some((key) => !key.content.trim())
  if (hasEmptyKey) {
    throw new Error('One or more keys are empty.')
  }
}

const BROADCAST_PHONE_NUMBER = Deno.env.get('BROADCAST_SOURCE_PHONE_NUMBER')
if (!BROADCAST_PHONE_NUMBER) {
  throw new Error('BROADCAST_SOURCE_PHONE_NUMBER environment variable is not set')
}
const MISSIVE_ORGANIZATION_ID = Deno.env.get('MISSIVE_ORGANIZATION_ID')
if (!MISSIVE_ORGANIZATION_ID && !isTesting) {
  throw new Error('MISSIVE_ORGANIZATION_ID environment variable is not set')
}

const getHeaders = (keyName: string) => {
  const key = missive_keys.find((k) => k.name === keyName)
  if (!key) throw new Error(`${keyName} not found`)
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key.content}`,
  }
}

const sendMessage = (message: string, toPhone: string) => {
  const body = {
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

  return fetch(CREATE_MESSAGE_URL, {
    method: 'POST',
    headers: getHeaders('missive_broadcast_use_secret'),
    body: JSON.stringify(body),
  })
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
    postData.posts.organization = MISSIVE_ORGANIZATION_ID
  }

  const response = await fetch(CREATE_POST_URL, {
    method: 'POST',
    headers: getHeaders('missive_secret'),
    body: JSON.stringify(postData),
  })

  if (!response.ok) {
    log.error(`HTTP error! detail: ${JSON.stringify(await response.json())}`)
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  return response.json()
}

const getMissiveMessage = async (id: string) => {
  const url = `${GET_MESSAGE_URL}${id}`
  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders('missive_broadcast_use_secret'),
  })
  if (response.ok) {
    return await response.json()
  } else {
    const errorMessage = `Failed to get Missive message. Message id: ${id}}, Missive's respond = ${
      JSON.stringify(await response.json())
    }`
    log.error(errorMessage)
    throw new Error(`HTTP error! status: ${response.status}, ${errorMessage}`)
  }
}

export default {
  sendMessage,
  createPost,
  getMissiveMessage,
  CREATE_MESSAGE_URL,
} as const
