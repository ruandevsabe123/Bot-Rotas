import type { BotServiceOptions } from "./connection";
import type { BotSnapshot, ImageUsageEntry } from "../shared/types";

export type BotWorkerInitMessage = {
  type: "init";
  options: BotServiceOptions;
};

export type BotWorkerCallMessage = {
  type: "call";
  id: string;
  method: string;
  args: unknown[];
};

export type BotWorkerShutdownMessage = {
  type: "shutdown";
};

export type BotWorkerIncomingMessage =
  | BotWorkerInitMessage
  | BotWorkerCallMessage
  | BotWorkerShutdownMessage;

export type BotWorkerReadyMessage = {
  type: "ready";
  snapshot: BotSnapshot;
};

export type BotWorkerResponseMessage = {
  type: "response";
  id: string;
  result?: unknown;
  error?: string;
  snapshot?: BotSnapshot;
};

export type BotWorkerSnapshotMessage = {
  type: "snapshot";
  snapshot: BotSnapshot;
};

export type BotWorkerSnapshotDirtyMessage = {
  type: "snapshot-dirty";
  critical: boolean;
};

export type BotWorkerImageAnalysisMessage = {
  type: "image-analysis";
  analysis: Partial<ImageUsageEntry> & { id: string; messageId: string; result: ImageUsageEntry["result"] };
};

export type BotWorkerRouteAutoValidatedMessage = {
  type: "route-auto-validated";
  routeId: string;
  analysisId?: string;
  leaderName?: string;
};

export type BotWorkerOutgoingMessage =
  | BotWorkerReadyMessage
  | BotWorkerResponseMessage
  | BotWorkerSnapshotMessage
  | BotWorkerSnapshotDirtyMessage
  | BotWorkerImageAnalysisMessage
  | BotWorkerRouteAutoValidatedMessage;
