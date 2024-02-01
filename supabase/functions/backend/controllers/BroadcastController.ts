import BroadcastService from "../services/BroadcastService.ts";
import { Request, Response } from "express";
import { body, param, query } from "express-validator";
import { BroadcastUpdate } from "../models/BroadcastRequestRespond.ts";
import { validateAndRespond } from "../misc/validator.ts";

async function make(_req: Request, res: Response) {
  await BroadcastService.make();
  return res.status(204).send({}); //TODO create response function
}

async function sendDraft(req: Request, res: Response) {
  const validations = [
    param("broadcastID").isInt().toInt(),
    query("isSecond").optional().isBoolean().toBoolean(),
  ];
  await validateAndRespond(validations, req, res);

  const id = Number(req.params.broadcastID);
  const { isSecond } = req.query;

  await BroadcastService.sendBroadcastMessage(id, Boolean(isSecond));
  return res.status(204).send({}); //TODO create response function
}

async function getAll(req: Request, res: Response) {
  const validations = [
    query("limit").optional().isInt().toInt(),
    query("cursor").optional().isInt().toInt(),
  ];
  await validateAndRespond(validations, req, res);
  const { limit, cursor } = req.query;

  const result = await BroadcastService.getAll(limit, cursor);
  return res.status(200).json(result); //TODO create response function
}

async function getOne(req: Request, res: Response) {
  const validations = [
    param("id").isInt().toInt(),
  ];

  await validateAndRespond(validations, req, res);
  const id = Number(req.params.id);

  const result = await BroadcastService.getOne(id);
  return res.status(200).json(result); //TODO create response function
}

async function patch(req: Request, res: Response) {
  const validations = [
    param("id").isInt().toInt(),
    body("firstMessage").optional().isString().notEmpty(),
    body("secondMessage").optional().isString().notEmpty(),
    body("runAt").optional().isDecimal(),
    body("delay").optional().isString().notEmpty(),
    body().custom((value: BroadcastUpdate, { req }) => {
      const validKeys = ["firstMessage", "secondMessage", "runAt", "delay"];
      const invalidKeys = Object.keys(value).filter((key) =>
        !validKeys.includes(key)
      );

      if (invalidKeys.length > 0) {
        throw new Error(
          `Invalid keys in request body: ${invalidKeys.join(", ")}`,
        );
      }
      if (Object.keys(req.body).length === 0) {
        throw new Error("Request body is empty");
      }

      return true;
    }),
  ];

  await validateAndRespond(validations, req, res);
  const id = Number(req.params.id);
  const broadcast: BroadcastUpdate = req.body;

  const result = await BroadcastService.patch(id, broadcast);
  return res.status(200).json(result); //TODO create response function
}

export default {
  make,
  sendDraft,
  getAll,
  getOne,
  patch,
} as const;
