import BroadcastService from "../services/BroadcastService.ts";
import { Request, Response } from "express";

async function make(_req: Request, res: Response) {
  await BroadcastService.make();
  return res.status(204);
}

async function sendDraft(_req: Request, res: Response) {
  await BroadcastService.sendDraftMessage();
  return res.status(204);
}

export default {
  make,
  sendDraft,
} as const;
