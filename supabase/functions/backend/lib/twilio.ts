import * as base64 from 'base64'
import { twilioBase } from '../constants/Missive.ts'

const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!
const getTwilioHeaders = (): Headers => {
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const credentials = `${ACCOUNT_SID}:${authToken}`
  const authHeader = `Basic ${base64.fromUint8Array(new TextEncoder().encode(credentials))}`
  const headers = new Headers()
  headers.set('Authorization', authHeader)
  return headers
}

const getTwilioMessages = async (
  nextPage: string,
  broadcastDate: Date,
): Response => {
  const broadcastNumber = Deno.env.get('BROADCASTNUMBER')!
  const formattedDate = broadcastDate.toISOString().split('T')[0]
  const headers = getTwilioHeaders()
  let twilioURL = ''

  if (nextPage) {
    twilioURL = `${twilioBase}${nextPage}`
  } else {
    twilioURL =
      `${twilioBase}/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json?DateSent=${formattedDate}&From=${broadcastNumber}&PageSize=100`
  }

  return await fetch(twilioURL, {
    method: 'GET',
    headers,
  })
}

export { getTwilioHeaders, getTwilioMessages }
