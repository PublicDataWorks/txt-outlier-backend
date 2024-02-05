import { Router } from 'express'

import Paths from '../constants/Paths.ts'
import BroadcastController from '../controllers/BroadcastController.ts'

const apiRouter = Router()
const userRouter = Router()
const broadcastRouter = Router()

broadcastRouter.get(
  Paths.Broadcast.Make,
  BroadcastController.makeBroadcast,
)

broadcastRouter.get(
  Paths.Broadcast.Draft,
  BroadcastController.sendDraft,
)

broadcastRouter.get(
  Paths.Broadcast.All,
  BroadcastController.getAll,
)

broadcastRouter.patch(
  Paths.Broadcast.ID,
  BroadcastController.patch,
)

apiRouter.use(Paths.Users.Base, userRouter)
apiRouter.use(Paths.Broadcast.Base, broadcastRouter) // TODO: add serviceTokenVerify back

export default apiRouter
