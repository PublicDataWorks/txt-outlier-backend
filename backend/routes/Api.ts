import { Router } from 'express'

import Paths from '../constants/Paths.ts'
import broadcastController from '../controllers/BroadcastController.ts'
import serviceRoleKeyVerify from '../middlewares/serviceRoleKeyVerify.ts'
import serviceTokenVerify from '../middlewares/serviceTokenVerify.ts'
import analysticsController from '../controllers/AnalysticsController.ts'

const apiRouter = Router()
const userRouter = Router()
const broadcastRouter = Router()
const analysticsRouter = Router()

broadcastRouter.get(
  Paths.Broadcast.Make,
  serviceRoleKeyVerify,
  broadcastController.makeBroadcast,
)

broadcastRouter.get(
  Paths.Broadcast.SendNow,
  serviceTokenVerify,
  broadcastController.sendNow,
)

broadcastRouter.get(
  Paths.Broadcast.Draft,
  serviceTokenVerify,
  broadcastController.sendDraft,
)

broadcastRouter.get(
  Paths.Broadcast.All,
  serviceTokenVerify,
  broadcastController.getAll,
)

broadcastRouter.patch(
  Paths.Broadcast.ID,
  serviceTokenVerify,
  broadcastController.patch,
)

broadcastRouter.get(
  Paths.Broadcast.UpdateTwilioStatus,
  serviceRoleKeyVerify,
  broadcastController.updateTwilioStatus,
)

analysticsRouter.get(
  '',
  analysticsController.getUnsubcribeReport
)

apiRouter.use(Paths.Users.Base, userRouter)
apiRouter.use(Paths.Broadcast.Base, broadcastRouter)
apiRouter.use(Paths.Analytics.Base, analysticsRouter)

export default apiRouter
