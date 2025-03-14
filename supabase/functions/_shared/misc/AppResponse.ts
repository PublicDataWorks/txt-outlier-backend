const USER_UNAUTHORIZED_ERR = 'Unauthorized'
const BAD_REQUEST_ERR = 'Bad Request'
const INTERNAL_SERVER_ERR = 'Internal Server Error'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('SIDEBAR_ALLOWED_ORIGINS') || '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': '*',
}

const unauthorized = (errorMessage: string = USER_UNAUTHORIZED_ERR) => {
  return new Response(JSON.stringify({ message: errorMessage }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

const ok = (body = {}) => {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

const badRequest = (errorMessage: string = BAD_REQUEST_ERR) => {
  return new Response(JSON.stringify({ message: errorMessage }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

const internalServerError = (errorMessage: string = INTERNAL_SERVER_ERR) => {
  return new Response(JSON.stringify({ message: errorMessage }), {
    status: 500,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

export default {
  unauthorized,
  ok,
  badRequest,
  internalServerError,
} as const
