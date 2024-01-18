import morgan from "morgan";
import helmet from "helmet";
import express, { NextFunction, Request, Response } from "express";

import "express-async-errors";

import BaseRouter from "./routes/Api.ts";
import Paths from "./constants/Paths.ts";
import RouteError from "./exception/RouteError.ts";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
// Security
app.use(helmet());

// Add APIs, must be after middleware
app.use(Paths.Base, BaseRouter);

// Add error handler
app.use((
  err: Error,
  _: Request,
  res: Response,
  _next: NextFunction,
) => {
  let status = 400;
  if (err instanceof RouteError) {
    status = err.status;
  }
  return res.status(status).json({ error: err.message });
});
export default app;
