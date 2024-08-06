import { Router } from 'express'

import Paths from '../constants/Paths.ts'
import broadcastController from '../controllers/BroadcastController.ts'
import serviceRoleKeyVerify from '../middlewares/serviceRoleKeyVerify.ts'
import serviceTokenVerify from '../middlewares/serviceTokenVerify.ts'
import missiveWebhookCallbackVerify from '../middlewares/missiveWebhookCallbackVerify.ts'

const apiRouter = Router()
const userRouter = Router()
const broadcastRouter = Router()
const commentRouter = Router()

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

broadcastRouter.get(
  Paths.Broadcast.UpdateTwilioStatus,
  serviceRoleKeyVerify,
  broadcastController.updateTwilioStatus,
)

broadcastRouter.get(
  Paths.Broadcast.SendPost,
  serviceRoleKeyVerify,
  broadcastController.sendPost,
)

commentRouter.post(
  Paths.Comment.Unsubscribe,
  missiveWebhookCallbackVerify,
  broadcastController.commentChangeSubscription,
)

commentRouter.post(
  Paths.Comment.Resubscribe,
  missiveWebhookCallbackVerify,
  broadcastController.commentChangeSubscription,
)

apiRouter.use(Paths.Users.Base, userRouter)
apiRouter.use(Paths.Broadcast.Base, broadcastRouter)
apiRouter.use(Paths.Comment.Base, commentRouter)

export default apiRouter
