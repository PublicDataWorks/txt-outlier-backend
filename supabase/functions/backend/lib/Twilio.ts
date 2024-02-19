import * as base64 from 'base64'

const TWILIO_BASE = 'https://api.twilio.com'
const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
const PAGINATION_DONE = 'DONE'
const SUCCESS_STATUSES = ['received', 'delivered']
const getTwilioHeaders = (): Headers => {
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const credentials = `${ACCOUNT_SID}:${authToken}`
  const authHeader = `Basic ${base64.fromUint8Array(new TextEncoder().encode(credentials))}`
  const headers = new Headers()
  headers.set('Authorization', authHeader)
  return headers
}

const getTwilioMessages = async (
  nextPage: string | undefined | null,
  broadcastDate: Date,
): Promise<Response> => {
  const broadcastNumber = Deno.env.get('BROADCASTNUMBER')!
  const formattedDate = broadcastDate.toISOString().split('T')[0]
  const headers = getTwilioHeaders()
  let twilioURL = ''

  if (nextPage) {
    twilioURL = `${TWILIO_BASE}${nextPage}`
  } else {
    twilioURL =
      `${TWILIO_BASE}/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json?DateSent=${formattedDate}&From=${broadcastNumber}&PageSize=100`
  }

  return await fetch(twilioURL, {
    method: 'GET',
    headers,
  })
}

export default { getTwilioHeaders, getTwilioMessages, PAGINATION_DONE, SUCCESS_STATUSES }
