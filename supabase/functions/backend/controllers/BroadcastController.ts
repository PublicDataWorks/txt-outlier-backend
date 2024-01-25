import BroadcastService from "../services/BroadcastService.ts";
import { Request, Response } from "express";
import { body, param, query, validationResult } from "express-validator";
import { BroadcastUpdate } from "../models/Broadcast.ts";

async function make(_req: Request, res: Response) {
  await BroadcastService.make();
  return res.status(204).send({});
}

async function sendDraft(_req: Request, res: Response) {
  await BroadcastService.sendDraftMessage();
  return res.status(204).send({});
}

async function getAll(req: Request, res: Response) {
  const validations = [
    query("limit").optional().isInt().toInt(),
    query("cursor").optional().isInt().toInt(),
  ];
  await Promise.all(validations.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const { limit, cursor } = req.query;

  const result = await BroadcastService.getAll(limit, cursor);
  return res.status(200).json(result);
}

async function getOne(req: Request, res: Response) {
  const validations = [
    param("id").isInt().toInt(),
  ];

  await Promise.all(validations.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const id = Number(req.params.id);

  const result = await BroadcastService.getOne(id);
  return res.status(200).json(result);
}

async function patch(req: Request, res: Response) {
  if (req.body === undefined || req.body === null) {
    return res.status(400).json({ error: "Request body is undefined or null" });
  }

  const validations = [
    param("id").isInt().toInt(),
    body("firstMessage").optional().isString().notEmpty(),
    body("secondMessage").optional().isString().notEmpty(),
    body("runAt").optional().isDecimal(),
    body("delay").optional().isString().notEmpty(),
    body().custom((value: BroadcastUpdate) => {
      const validKeys = ["firstMessage", "secondMessage", "runAt", "delay"];
      const invalidKeys = Object.keys(value).filter((key) =>
        !validKeys.includes(key)
      );

      if (invalidKeys.length > 0) {
        throw new Error(
          `Invalid keys in request body: ${invalidKeys.join(", ")}`,
        );
      }
      return true;
    }),
  ];

  await Promise.all(validations.map((validation) => validation.run(req)));
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  const id = Number(req.params.id);
  const broadcast: BroadcastUpdate = req.body;

  const result = await BroadcastService.patch(id, broadcast);
  return res.status(200).json(result);
}

export default {
  make,
  sendDraft,
  getAll,
  getOne,
  patch,
} as const;
