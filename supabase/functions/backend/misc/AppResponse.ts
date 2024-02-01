import { Response } from "express";

const USER_UNAUTHORIZED_ERR = "Unauthorized";

const unauthorized = (res: Response) => {
  return res.status(401).json({ message: USER_UNAUTHORIZED_ERR });
};
const invalidRequest = (res: Response, errorMessage: string) => {
  return res.status(400).json({ message: errorMessage });
};

export default {
  unauthorized,
  invalidRequest,
} as const;
