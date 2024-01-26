import { Router } from "express";

import Paths from "../constants/Paths.ts";
import UserController from "../controllers/UserController.ts";
import broadcastController from "../controllers/BroadcastController.ts";
import serviceTokenVerify from "../middlewares/serviceTokenVerify.ts";

const apiRouter = Router();
const userRouter = Router();
const broadcastRouter = Router();

// Get all users
userRouter.get(
  Paths.Users.All,
  UserController.getAll,
);

broadcastRouter.get(
  Paths.Broadcast.Make,
  broadcastController.make,
);

broadcastRouter.get(
  Paths.Broadcast.Draft,
  broadcastController.sendDraft,
);

broadcastRouter.get(
  Paths.Broadcast.All,
  broadcastController.getAll,
);

broadcastRouter.get(
  Paths.Broadcast.ID,
  broadcastController.getOne,
);

broadcastRouter.patch(
  Paths.Broadcast.ID,
  broadcastController.patch,
);

apiRouter.use(Paths.Users.Base, userRouter);
apiRouter.use(Paths.Broadcast.Base, serviceTokenVerify, broadcastRouter);

export default apiRouter;
