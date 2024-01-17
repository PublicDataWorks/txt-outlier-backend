import { Router } from 'express';

import Paths from '../constants/Paths.ts';
import UserController from '../controllers/UserController.ts';


const apiRouter = Router();
const userRouter = Router();

// Get all users
userRouter.get(
  Paths.Users.Get,
  UserController.getAll,
);

apiRouter.use(Paths.Users.Base, userRouter);

export default apiRouter;
