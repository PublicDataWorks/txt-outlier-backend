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
      // 'send_at': 1994540565,
      'send': true, // Send right away
    },
  }
  return fetch(CREATE_MESSAGE_URL, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
  })
}

export default {
  sendMessage,
  CREATE_MESSAGE_URL,
} as const
