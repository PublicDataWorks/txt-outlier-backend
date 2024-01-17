import { Router } from 'express';

import Paths from '../constants/Paths.ts';
import UserController from '../controllers/UserController.ts';
import broadcastController from "../controllers/BroadcastController.ts";


const apiRouter = Router();
const userRouter = Router();
const broadcastRouter = Router();

// Get all users
userRouter.get(
  Paths.Users.Get,
  UserController.getAll,
);

broadcastRouter.post(
    Paths.Broadcast.Make,
    broadcastController.make,
);

apiRouter.use(Paths.Users.Base, userRouter);
apiRouter.use(Paths.Broadcast.Base, broadcastRouter);

export default apiRouter;
