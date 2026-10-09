import { decodeHex } from 'encoding/hex.ts'
import UnauthorizedError from '../exception/UnauthorizedError.ts'

// Lives in its own module so tests can import the real function: the tests' import map replaces Missive.ts with a mock.
// deno-lint-ignore no-explicit-any
export const verifySignature = async (req: Request, requestBody: any): Promise<boolean> => {
  if (Deno.env.get('IS_TESTING')) return true

  const headerSig = req.headers.get('x-hook-signature')
  if (!headerSig) {
    throw new UnauthorizedError('Missing signature header')
  }

  const hmacSecret = Deno.env.get('HMAC_SECRET')
  if (!hmacSecret) {
    throw new Error('HMAC_SECRET is not defined in environment variables')
  }
  const keyPrefix = 'sha256='
  const cleanedHeaderSig = headerSig.startsWith(keyPrefix) ? headerSig.slice(keyPrefix.length) : headerSig
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

  // decodeHex throws on non-hex characters and on odd lengths. Both are just a bad signature.
  let receivedSignature: Uint8Array
  try {
    receivedSignature = decodeHex(cleanedHeaderSig)
  } catch {
    return false
  }

  return await crypto.subtle.verify(
    { name: 'HMAC', hash: 'SHA-256' },
    key,
    receivedSignature,
    data.buffer,
  )
}
