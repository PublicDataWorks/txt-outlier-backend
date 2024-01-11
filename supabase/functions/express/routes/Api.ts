import { Router } from 'express';
import validator from 'validator';
import { Request, Response, NextFunction } from 'express';

import Paths from '../constants/Paths.ts';
import User from '../models/User.ts';
import UserRoutes from './UserRoutes.ts';

// **** Variables **** //

const apiRouter = Router();

// ** Add UserRouter ** //

const userRouter = Router();

// Get all users
userRouter.get(
  Paths.Users.Get,
  UserRoutes.getAll,
);

// Add one user
userRouter.post(
  Paths.Users.Add,
  (req: Request, res: Response, next: NextFunction) => {
    if (!validator.isObject(req.body.user) || !User.isUser(req.body.user)) {
      return res.status(400).send('Invalid user object');
    }

    next();
  },
  UserRoutes.add,
);

// Update one user
userRouter.put(
  Paths.Users.Update,
  (req: Request, res: Response, next: NextFunction) => {
    if (!validator.isObject(req.body.user) || !User.isUser(req.body.user)) {
      return res.status(400).send('Invalid user object');
    }

    next();
  },
  UserRoutes.update,
);

// Delete one user
userRouter.delete(
  Paths.Users.Delete,
  (req: Request, res: Response, next: NextFunction) => {
    if (!validator.isNumeric(req.params.id)) {
      return res.status(400).send('Invalid user ID');
    }

    next();
  },
  UserRoutes.delete,
);

// Add UserRouter
apiRouter.use(Paths.Users.Base, userRouter);
// **** Export default **** //

export default apiRouter;
