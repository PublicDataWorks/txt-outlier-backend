import { Router } from 'express'

import Paths from '../constants/Paths.ts'
import broadcastController from '../controllers/BroadcastController.ts'

const apiRouter = Router()
const userRouter = Router()
const broadcastRouter = Router()

broadcastRouter.get(
  Paths.Broadcast.Make,
  broadcastController.make,
)

broadcastRouter.get(
  Paths.Broadcast.Draft,
  broadcastController.sendDraft,
)

broadcastRouter.get(
  Paths.Broadcast.All,
  broadcastController.getAll,
)

broadcastRouter.patch(
  Paths.Broadcast.ID,
  broadcastController.patch,
)

broadcastRouter.get(
  Paths.Broadcast.UpdateTwilioStatus,
  broadcastController.updateTwilioStatus,
)

apiRouter.use(Paths.Users.Base, userRouter)
apiRouter.use(Paths.Broadcast.Base, broadcastRouter) // TODO: add serviceTokenVerify back

export default apiRouter
