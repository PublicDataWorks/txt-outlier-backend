import twilio from 'twilio'
const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!
const client = twilio(accountSid, authToken)

const getMessages = async (dateSentAfter: Date, pageToken?: string, dateSentBefore?: Date) => {
  const messages = await client.messages.page({
    from: Deno.env.get('BROADCAST_SOURCE_PHONE_NUMBER')!,
    pageSize: 300,
    dateSentAfter,
    dateSentBefore,
    pageToken: pageToken,
  })
  return {
    messages: messages.instances,
    nextPageUrl: messages.nextPageUrl,
  }
}

export default { getMessages }
