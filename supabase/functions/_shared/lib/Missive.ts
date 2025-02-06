const CREATE_MESSAGE_URL = 'https://public.missiveapp.com/v1/drafts'
const CREATE_POST_URL = 'https://public.missiveapp.com/v1/posts'
const BROADCAST_PHONE_NUMBER = Deno.env.get('BROADCAST_SOURCE_PHONE_NUMBER')!
const MISSIVE_ORGANIZATION_ID = Deno.env.get('MISSIVE_ORGANIZATION_ID')!
const MISSIVE_SECRET_BROADCAST_SECOND_MESSAGES = Deno.env.get('MISSIVE_SECRET_BROADCAST_SECOND_MESSAGES')!
const MISSIVE_SECRET_BROADCAST_FIRST_MESSAGES = Deno.env.get('MISSIVE_SECRET_BROADCAST_FIRST_MESSAGES')!
const MISSIVE_SECRET_NON_BROADCAST = Deno.env.get('MISSIVE_SECRET_NON_BROADCAST')!

const sendMessage = (message: string, toPhone: string, isSecond: boolean) => {
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
  const apiToken = isSecond ? MISSIVE_SECRET_BROADCAST_SECOND_MESSAGES : MISSIVE_SECRET_BROADCAST_FIRST_MESSAGES
  return fetch(CREATE_MESSAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`,
    },
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
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MISSIVE_SECRET_NON_BROADCAST}`,
    },
    body: JSON.stringify(postData),
  })

  if (!response.ok) {
    console.error(`HTTP error! detail: ${JSON.stringify(await response.json())}`)
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  return response.json()
}

export default {
  sendMessage,
  createPost,
  CREATE_MESSAGE_URL,
} as const
