import { Response } from "express";

const USER_UNAUTHORIZED_ERR = "Unauthorized";

const unauthorized = (res: Response) => {
  return res.status(401).json({ message: USER_UNAUTHORIZED_ERR });
};

export default {
  unauthorized,
} as const;
