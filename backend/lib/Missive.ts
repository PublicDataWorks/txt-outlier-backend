import * as log from 'log'

const CREATE_MESSAGE_URL = 'https://public.missiveapp.com/v1/drafts'
const CREATE_POST_URL = 'https://public.missiveapp.com/v1/posts'

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${Deno.env.get('MISSIVE_SECRET')}`,
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
