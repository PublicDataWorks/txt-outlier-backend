import BroadcastService from '../_shared/services/BroadcastService.ts'
import AppResponse from '../_shared/misc/AppResponse.ts'
import Sentry from '../_shared/lib/Sentry.ts'

Deno.serve(async (req) => {
  try {
    const { broadcastId } = await req.json()
    if (!broadcastId) {
      return AppResponse.badRequest('BroadcastId must be provided')
    }

    await BroadcastService.archiveBroadcastDoubleFailures(broadcastId)
  } catch (error) {
    console.error(`Error in BroadcastService.archiveBroadcastDoubleFailures: ${error.message}. Stack: ${error.stack}`)
    // Cron job calls this function, so we don't want to throw an error
    Sentry.captureException(error)
  }
  return AppResponse.ok()
})
