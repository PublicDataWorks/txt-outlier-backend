import BroadcastService from "../_shared/services/BroadcastService.ts";
import AppResponse from "../_shared/misc/AppResponse.ts";
import Sentry from "../_shared/lib/Sentry.ts";

Deno.serve(async (req) => {
  try {
    switch (req.method) {
      case "GET": {
        const url = new URL(req.url);
        const limit = Number(url.searchParams.get("limit")) || 5;
        const cursor = Number(url.searchParams.get("cursor")) || undefined;
        const result = await BroadcastService.getAll(limit, cursor);
        return AppResponse.ok(result);
      }

      case "PATCH": {
        const { id, firstMessage, secondMessage, runAt, delay } = await req.json();
        const result = await BroadcastService.patch(id, { firstMessage, secondMessage, runAt, delay });
        return AppResponse.ok(result);
      }
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);

    Sentry.captureException(error);
    return AppResponse.internalServerError();
  }
});
