import { Broadcast } from "../drizzle/schema.ts";

import { intervalToString } from "../misc/utils.ts";

interface PastBroadcastResponse {
  id: number;
  firstMessage: string;
  secondMessage: string;
  runAt: number;
  totalSent: number;
  successfullyDelivered: number;
  failedDelivered: number;
}

interface UpcomingBroadcastResponse {
  id: number | null;
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

function convertToPastBroadcast(
  broadcast: Broadcast,
): PastBroadcastResponse {
  return {
    id: Number(broadcast.id),
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: Math.floor(broadcast.runAt.getTime() / 1000),
    totalSent: 0,
    successfullyDelivered: 0,
    failedDelivered: 0,
  };
}

function convertToUpcomingBroadcast(
  broadcast: Broadcast,
): UpcomingBroadcastResponse {
  return {
    id: Number(broadcast.id),
    firstMessage: broadcast.firstMessage,
    secondMessage: broadcast.secondMessage,
    runAt: Math.floor(broadcast.runAt.getTime() / 1000),
    delay: intervalToString(broadcast.delay!), // TODO: Not sure why we need to add ! here
  };
}

class BroadcastResponse {
  upcoming: UpcomingBroadcastResponse;
  past: PastBroadcastResponse[];
  currentCursor: number | null;

  constructor() {
    this.upcoming = {
      id: null,
      firstMessage: "",
      secondMessage: "",
      runAt: -1,
      delay: "",
    };
    this.past = [];
    this.currentCursor = null;
  }
}

function convertToFutureBroadcast(
    broadcast: Broadcast,
): Broadcast {
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

export {
  BroadcastResponse,
  type BroadcastUpdate,
  convertToPastBroadcast,
  convertToUpcomingBroadcast,
  type PastBroadcastResponse,
  type UpcomingBroadcastResponse,
  convertToFutureBroadcast,
};
