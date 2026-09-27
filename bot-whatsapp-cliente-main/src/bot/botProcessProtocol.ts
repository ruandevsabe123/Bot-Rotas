import type { BotServiceOptions, DispatchRaceEventState } from "./connection";
import type { BotSnapshot, ImageUsageEntry, RouteDispatch } from "../shared/types";

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

export type BotWorkerDispatchGateResponseMessage = {
  type: "dispatch-gate-response";
  id: string;
  token?: string;
  waitedMs?: number;
  error?: string;
};

export type BotWorkerIncomingMessage =
  | BotWorkerInitMessage
  | BotWorkerCallMessage
  | BotWorkerShutdownMessage
  | BotWorkerDispatchGateResponseMessage;

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
  route?: RouteDispatch;
};

export type BotWorkerDispatchGateRequestMessage = {
  type: "dispatch-gate-request";
  id: string;
  clientEmail: string;
  groupKey: string;
  eventDetectedAt: number;
  eventKey?: string;
  targetDispatchMode?: "manual" | "ocr";
};

export type BotWorkerDispatchGateRelayMessage = {
  type: "dispatch-gate-relay";
  token: string;
  clientEmail: string;
  relayedAt: number;
};

export type BotWorkerDispatchGateFailureMessage = {
  type: "dispatch-gate-failure";
  token: string;
  clientEmail: string;
  failedAt: number;
};

export type BotWorkerDispatchRaceEventMessage = {
  type: "dispatch-race-event";
  clientEmail: string;
  groupKey: string;
  eventDetectedAt: number;
  eventKey: string;
  state: DispatchRaceEventState;
};

export type BotWorkerOutgoingMessage =
  | BotWorkerReadyMessage
  | BotWorkerResponseMessage
  | BotWorkerSnapshotMessage
  | BotWorkerSnapshotDirtyMessage
  | BotWorkerImageAnalysisMessage
  | BotWorkerRouteAutoValidatedMessage
  | BotWorkerDispatchGateRequestMessage
  | BotWorkerDispatchGateRelayMessage
  | BotWorkerDispatchGateFailureMessage
  | BotWorkerDispatchRaceEventMessage;
