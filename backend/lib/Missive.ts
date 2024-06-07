import { ConsoleLogWriter } from 'drizzle-orm'

const CREATE_POST_URL = 'https://public.missiveapp.com/v1/posts'
const CREATE_MESSAGE_URL = 'https://public.missiveapp.com/v1/drafts'
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${Deno.env.get('MISSIVE_SECRET')}`,
}

const sendMessage = (message: string, toPhone: string) => {
  const body = {
    drafts: {
      'body': message,
      'to_fields': [
        { 'phone_number': toPhone },
      ],
      'from_field': {
        'phone_number': '+18336856203', // TODO: Get it from ENV
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

const sendPost = async (markdowns: string[], conversationId: string) => {
  const attachments = markdowns.map((markdown) => ({
    markdown: markdown,
    color: 'good',
  }))

  const body = {
    'posts': {
      'conversation': conversationId,
      'notification': { 'title': 'Weekly Report', 'body': 'Summary' },
      'username': 'Weekly report',
      'username_icon': 'https://s3.amazonaws.com/missive-assets/missive-avatar.png',
      attachments,
    },
  }

  await fetch(CREATE_POST_URL, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
  })
}

export default {
  sendMessage,
  sendPost,
  CREATE_MESSAGE_URL,
} as const
