import UserService from "../services/UserService.ts";
import { Request, Response } from "express";

async function getAll(_: Request, res: Response) {
  const users = await UserService.getAll();
  return res.status(200).json({ users });
}

export default {
  getAll,
} as const;
