import { broadcasts } from "../drizzle/schema.ts";

import { intervalToString } from "../misc/utils.ts";

interface BroadcastWithTotalSent {
  id: number;
  runAt: number;
  totalSent: number;
  succesfullyDelivered: number;
  failedDelivered: number;
}

interface BroadcastWithoutTotalSent {
  id: number;
  firstMessage: string;
  secondMessage: string;
  runAt: number;
  delay: string;
}

interface BroadcastUpdate {
  firstMessage?: string;
  secondMessage?: string;
  runAt?: number;
  delay?: string;
}

function convertToBroadcastWithTotalSent(
  broadcast: broadcasts,
): BroadcastWithTotalSent {
  return {
    id: Number(broadcast.id),
    runAt: Math.floor(broadcast.runAt.getTime() / 1000),
    // totalSent: broadcast.totalSent,
    // succesfullyDelivered: broadcast.succesfullyDelivered,
    // failedDelivered: broadcast.failedDelivered,
    //placeholder TODO
    totalSent: 0,
    succesfullyDelivered: 0,
    failedDelivered: 0,
  };
}

function convertToBroadcastWithoutTotalSent(
  broadcast: broadcasts,
): BroadcastWithoutTotalSent {
  return {
    id: Number(broadcast.id),
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: Math.floor(broadcast.runAt.getTime() / 1000),
    delay: intervalToString(broadcast.delay),
  };
}

function convertToFutureBroadcast(
    broadcast: broadcasts,
): broadcasts {
  return {
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: broadcast.runAt,
    updatedAt: broadcast.updatedAt,
    delay: broadcast.delay,
    editable: broadcast.editable,
    noUsers: broadcast.noUsers,
  };
}

interface ReturnModel {
  upcoming: BroadcastWithTotalSent;
  past: BroadcastWithoutTotalSent[];
  currentCursor?: number;
}

export {
  BroadcastUpdate,
  BroadcastWithoutTotalSent,
  BroadcastWithTotalSent,
  convertToBroadcastWithoutTotalSent,
  convertToBroadcastWithTotalSent,
  convertToFutureBroadcast,
  ReturnModel,
};
