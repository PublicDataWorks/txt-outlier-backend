import BroadcastService from '../_shared/services/BroadcastService.ts'
import NotFoundError from '../_shared/exception/NotFoundError.ts'
import BadRequestError from '../_shared/exception/BadRequestError.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

Deno.serve(async (_req) => {
  try {
    await BroadcastService.sendNow()
  } catch (error) {
    console.error(`Error in BroadcastService.sendNow: ${error.message}. Stack: ${error.stack}`)
    Sentry.captureException(error)
    if (error instanceof NotFoundError || error instanceof BadRequestError) {
      return AppResponse.badRequest(error.message)
    }
    return AppResponse.internalServerError(error.message)
  }
  return AppResponse.ok()
})
