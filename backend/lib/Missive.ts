import * as log from 'log'
import supabase from './supabase.ts'
import { lookupTemplate } from '../drizzle/schema.ts'
import { eq, or } from 'drizzle-orm'

export const isTesting = Deno.env.get('ENV') === 'testing'

const CREATE_MESSAGE_URL = 'https://public.missiveapp.com/v1/drafts'
const CREATE_POST_URL = 'https://public.missiveapp.com/v1/posts'

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
  const missiveSecretKey = missive_keys.find((key) => key.name === 'missive_broadcast_use_secret')

  if (!missiveSecretKey) {
    throw new Error('missive_broadcast_use_secret key not found')
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${missiveSecretKey.content}`,
  }

  return fetch(CREATE_MESSAGE_URL, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
  })
}

const createPost = async (postBody: string) => {
  const postData = {
    posts: {
      notification: {
        title: 'System',
        body: postBody,
      },
    },
  }

  const missiveSecretKey = missive_keys.find((key) => key.name === 'missive_secret')

  if (!missiveSecretKey) {
    throw new Error('MISSIVE_SECRET key not found')
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${missiveSecretKey.content}`,
  }

  const response = await fetch(CREATE_POST_URL, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(postData),
  })

  if (!response.ok) {
    log.error(`HTTP error! detail: ${response.body}`)
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  return response.json()
}

export default {
  sendMessage,
  createPost,
  CREATE_MESSAGE_URL,
} as const
