import { NextFunction, Request, Response } from 'express'
import * as log from 'log'
import * as DenoSentry from 'sentry/deno'
import { decodeHex } from 'encoding/hex.ts'
import AppResponse from '../misc/AppResponse.ts'

const missiveWebhookCallbackVerify = async (req: Request, res: Response, next: NextFunction) => {
  const requestHeaderSig = req.headers['x-hook-signature']

  if (!requestHeaderSig || typeof requestHeaderSig !== 'string') {
    DenoSentry.captureException('Bad Request: X-Hook-Signature header is missing or invalid')
    return res.status(401).json({ error: 'Missing or invalid authentication header' })
  }

  try {
    const verified = await verifySignature(requestHeaderSig, req.body)
    if (!verified) {
      DenoSentry.captureException('Signature not match')
      return AppResponse.unauthorized(res)
    }
    next()
  } catch (error) {
    log.error('Error during signature verification:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

// deno-lint-ignore no-explicit-any
const verifySignature = async (hash: string, requestBody: any): Promise<boolean> => {
  if (Deno.env.get('ENV') === 'testing') return true

  const hmacSecret = Deno.env.get('HMAC_SECRET')
  if (!hmacSecret) {
    throw new Error('HMAC_SECRET is not defined in environment variables')
  }
  const keyPrefix = 'sha256='
  const cleanedHeaderSig = hash.startsWith(keyPrefix) ? hash.slice(keyPrefix.length) : hash
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

export default missiveWebhookCallbackVerify
