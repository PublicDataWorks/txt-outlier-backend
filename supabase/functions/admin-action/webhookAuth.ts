import { decodeHex } from 'encoding/hex.ts'

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

export { verifySignature }
