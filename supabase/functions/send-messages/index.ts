import BroadcastService from '../_shared/services/BroadcastService.ts';
import AppResponse from "../_shared/misc/AppResponse.ts";
import Sentry from "../_shared/lib/Sentry.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return AppResponse.badRequest('Method not allowed');
  }

  try {
    const body = await req.json();
    const { broadcastId, isSecond } = body;
    if (!broadcastId || isNaN(Number(broadcastId))) {
      return AppResponse.badRequest('Invalid broadcastId');
    }

    const id = Number(broadcastId);
    const sendMessages = isSecond
      ? BroadcastService.sendBroadcastSecondMessages
      : BroadcastService.sendBroadcastFirstMessages;
    await sendMessages(id);
  } catch (error) {
    console.error(`Error in BroadcastService.sendMessages: ${error.message}. Stack: ${error.stack}`);
    Sentry.captureException(error);
    // Still return 200 since it's called by CRON
  }

  return AppResponse.ok();
});
