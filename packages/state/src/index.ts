export {};
import type {
  AssetKind,
  AssetRef,
  AssetStatus,
  EventEnvelope,
  EventReader,
  EventRecord,
  EvidenceRef,
  LedgerSeqGap,
  JsonValue,
  ProjectionDataRecord,
  ProjectionPersistence,
  ProjectionStateRecord,
  ReusableAsset,
  SnapshotRecord,
} from "@praxis/contracts";
import {
  assetStatusSchema,
  expectationStatusSchema,
  parseReusableAsset,
  parseExpectationRecord,
  parseVerificationResult,
} from "@praxis/contracts";
import { assertAssetTransition } from "@praxis/assets";
import type { ExpectationRecord } from "@praxis/contracts";

export interface Projection<TState> {
  name: string;
  version: number;
  initial(): TState;
  apply(state: TState, event: EventRecord): TState;
}

export type CatchUpStatus = "caught_up" | "failed";

export interface CatchUpResult {
  projectionName: string;
  projectionVersion: number;
  status: CatchUpStatus;
  fromSeq: number;
  lastSeq: number;
  applied: number;
  error?: string;
}

export interface ProjectState {
  eventCount: number;
  lastSeq: number;
  lastEventType?: string;
}

export interface RuleProjectionEntry {
  id: string;
  status: string;
  lastSeq: number;
}

export interface RuleState {
  rules: Record<string, RuleProjectionEntry>;
}

export interface AssetProjectionEntry {
  id: string;
  status: string;
  revision?: number;
  kind?: AssetKind;
  version?: string;
  body?: JsonValue;
  derivedFrom?: EvidenceRef[];
  forkedFrom?: AssetRef;
  lastSeq: number;
}

export interface AssetState {
  assets: Record<string, AssetProjectionEntry>;
}

export interface AgentCursor {
  agentId: string;
  lastSeq: number;
  revision: number;
  updatedAt: string;
}

export interface AgentState {
  cursors: Record<string, AgentCursor>;
}

export interface ExpectationProjectionEntry extends ExpectationRecord {
  cancelled?: boolean;
  cancelledAt?: string;
  lastVerificationRequestId?: string;
  lastEventSeq: number;
}

export interface ExpectationState {
  expectations: Record<string, ExpectationProjectionEntry>;
}

export class ProjectionEngine {
  constructor(
    private readonly reader: EventReader,
    private readonly persistence: ProjectionPersistence,
    private readonly batchSize = 1000,
  ) {
    if (
      !Number.isSafeInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > 10_000
    ) {
      throw new Error("batchSize must be an integer between 1 and 10000");
    }
  }

  catchUp<TState>(projection: Projection<TState>): CatchUpResult {
    const stored = this.persistence.getProjectionState(projection.name);
    if (stored !== null && stored.projectionVersion !== projection.version) {
      return this.rebuild(projection);
    }

    let state =
      stored === null
        ? projection.initial()
        : (stored.state as unknown as TState);
    let lastSeq = stored?.lastSeq ?? 0;
    const fromSeq = lastSeq;
    let applied = 0;

    while (true) {
      const events = this.reader.getSince(lastSeq, this.batchSize);
      if (events.length === 0) break;
      for (const event of events) {
        try {
          this.assertNextSeq(event.seq, lastSeq);
          state = projection.apply(deepFreeze(state), deepFreeze(event));
          const nextRecord = this.stateRecord(
            projection,
            state,
            event.seq,
            epochMilliseconds(event.recordedAt),
          );
          this.persistence.saveProjectionState(nextRecord, lastSeq);
          lastSeq = event.seq;
          applied += 1;
        } catch (error) {
          return this.failedResult(
            projection,
            fromSeq,
            lastSeq,
            applied,
            error,
          );
        }
      }
      if (events.length < this.batchSize) break;
    }

    return {
      projectionName: projection.name,
      projectionVersion: projection.version,
      status: "caught_up",
      fromSeq,
      lastSeq,
      applied,
    };
  }

  rebuild<TState>(projection: Projection<TState>): CatchUpResult {
    const previous = this.persistence.getProjectionState(projection.name);
    let state = projection.initial();
    let lastSeq = 0;
    let applied = 0;
    let updatedAt = previous?.updatedAt ?? 0;

    while (true) {
      const events = this.reader.getSince(lastSeq, this.batchSize);
      if (events.length === 0) break;
      for (const event of events) {
        try {
          this.assertNextSeq(event.seq, lastSeq);
          state = projection.apply(deepFreeze(state), deepFreeze(event));
          lastSeq = event.seq;
          updatedAt = epochMilliseconds(event.recordedAt);
          applied += 1;
        } catch (error) {
          return this.failedResult(
            projection,
            previous?.lastSeq ?? 0,
            previous?.lastSeq ?? 0,
            applied,
            error,
          );
        }
      }
      if (events.length < this.batchSize) break;
    }

    const record = this.stateRecord(projection, state, lastSeq, updatedAt);
    const data: ProjectionDataRecord[] = [
      {
        projectionName: projection.name,
        entityKey: "__root__",
        projectionVersion: projection.version,
        lastSeq,
        state: record.state,
        updatedAt,
      },
    ];
    try {
      this.persistence.replaceProjection(record, data);
    } catch (error) {
      return this.failedResult(
        projection,
        previous?.lastSeq ?? 0,
        previous?.lastSeq ?? 0,
        applied,
        error,
      );
    }

    return {
      projectionName: projection.name,
      projectionVersion: projection.version,
      status: "caught_up",
      fromSeq: 0,
      lastSeq,
      applied,
    };
  }

  createSnapshot<TState>(
    projection: Projection<TState>,
  ): SnapshotRecord | null {
    const state = this.persistence.getProjectionState(projection.name);
    if (state === null || state.projectionVersion !== projection.version) {
      return null;
    }
    const ledgerLastSeq = this.reader.getLastSeq();
    if (state.lastSeq > ledgerLastSeq) {
      throw new Error(
        "projection cursor " +
          state.lastSeq +
          " is ahead of ledger " +
          ledgerLastSeq,
      );
    }
    const snapshot: SnapshotRecord = {
      id: `snapshot:${projection.name}:${projection.version}:${state.lastSeq}`,
      projectionName: projection.name,
      projectionVersion: projection.version,
      cursorSeq: state.lastSeq,
      state: state.state,
      createdAt: state.updatedAt,
    };
    this.persistence.saveSnapshot(snapshot);
    return snapshot;
  }

  loadSnapshot<TState>(
    projection: Projection<TState>,
  ): (Omit<SnapshotRecord, "state"> & { state: TState }) | null {
    const snapshot = this.persistence.getSnapshot(
      projection.name,
      projection.version,
    );
    if (snapshot === null) return null;
    const ledgerLastSeq = this.reader.getLastSeq();
    if (snapshot.cursorSeq > ledgerLastSeq) {
      throw new Error(
        "snapshot cursor " +
          snapshot.cursorSeq +
          " is ahead of ledger " +
          ledgerLastSeq,
      );
    }
    return {
      ...snapshot,
      state: snapshot.state as unknown as TState,
    };
  }

  private stateRecord<TState>(
    projection: Projection<TState>,
    state: TState,
    lastSeq: number,
    updatedAt: number,
  ): ProjectionStateRecord {
    return {
      projectionName: projection.name,
      projectionVersion: projection.version,
      lastSeq,
      state: state as unknown as JsonValue,
      updatedAt,
    };
  }

  private failedResult<TState>(
    projection: Projection<TState>,
    fromSeq: number,
    lastSeq: number,
    applied: number,
    error: unknown,
  ): CatchUpResult {
    return {
      projectionName: projection.name,
      projectionVersion: projection.version,
      status: "failed",
      fromSeq,
      lastSeq,
      applied,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  private assertNextSeq(eventSeq: number, previousSeq: number): void {
    if (eventSeq === previousSeq + 1) return;
    const missingStart = previousSeq + 1;
    const missingEnd = eventSeq - 1;
    if (
      missingEnd >= missingStart &&
      this.isPurgedRange(missingStart, missingEnd)
    ) {
      return;
    }
    {
      throw new Error(
        "event sequence is not contiguous: expected " +
          (previousSeq + 1) +
          ", found " +
          eventSeq,
      );
    }
  }

  private isPurgedRange(startSeq: number, endSeq: number): boolean {
    const reader = this.reader as EventReader & {
      getPurgedSeqRanges?: () => LedgerSeqGap[];
    };
    if (reader.getPurgedSeqRanges === undefined) return false;
    const ranges = [...reader.getPurgedSeqRanges()].sort(
      (left, right) => left.startSeq - right.startSeq,
    );
    let cursor = startSeq;
    for (const range of ranges) {
      if (range.endSeq < cursor) continue;
      if (range.startSeq > cursor) return false;
      cursor = Math.max(cursor, range.endSeq + 1);
      if (cursor > endSeq) return true;
    }
    return false;
  }
}

export function createProjectProjection(): Projection<ProjectState> {
  return {
    name: "project",
    version: 1,
    initial: () => ({ eventCount: 0, lastSeq: 0 }),
    apply: (state, event) => ({
      eventCount: state.eventCount + 1,
      lastSeq: event.seq,
      lastEventType: event.type,
    }),
  };
}

export function createRuleProjection(): Projection<RuleState> {
  return {
    name: "rules",
    version: 1,
    initial: () => ({ rules: {} }),
    apply: (state, event) => {
      if (!event.type.startsWith("rule.")) return state;
      const id = payloadString(event, "id") ?? event.id;
      const status = event.type.slice("rule.".length);
      return {
        rules: {
          ...state.rules,
          [id]: { id, status, lastSeq: event.seq },
        },
      };
    },
  };
}

export function createAssetProjection(): Projection<AssetState> {
  return {
    name: "assets",
    version: 2,
    initial: () => ({ assets: {} }),
    apply: (state, event) => {
      if (!event.type.startsWith("asset.")) return state;
      const payload = jsonObject(event.payload);
      const nestedAsset = parseProjectedAsset(payload?.asset);
      const id = nestedAsset?.id ?? payloadString(event, "id") ?? event.id;
      const revision =
        nestedAsset?.revision ?? payloadSafeInteger(event, "revision");
      const previous = state.assets[id];
      const status =
        nestedAsset?.status ??
        legacyAssetStatus(event.type.slice("asset.".length));
      if (previous !== undefined && previous.status !== status) {
        assertProjectedAssetTransition(previous.status, status);
      }
      const entry: AssetProjectionEntry = {
        id,
        status,
        lastSeq: event.seq,
      };
      if (revision !== undefined) entry.revision = revision;
      else if (previous?.revision !== undefined)
        entry.revision = previous.revision;
      if (nestedAsset !== null) {
        entry.kind = nestedAsset.kind;
        entry.version = nestedAsset.version;
        entry.body = nestedAsset.body;
        entry.derivedFrom = nestedAsset.derivedFrom;
        if (nestedAsset.forkedFrom !== undefined) {
          entry.forkedFrom = nestedAsset.forkedFrom;
        }
      }
      return { assets: { ...state.assets, [id]: entry } };
    },
  };
}

export function createAgentProjection(): Projection<AgentState> {
  return {
    name: "agents",
    version: 1,
    initial: () => ({ cursors: {} }),
    apply: (state, event) => {
      if (event.type !== "agent.cursor.updated") return state;
      const agentId = payloadString(event, "agentId");
      const lastSeq = payloadSafeInteger(event, "lastSeq");
      const revision = payloadSafeInteger(event, "revision");
      if (
        agentId === undefined ||
        lastSeq === undefined ||
        revision === undefined
      ) {
        return state;
      }
      if (lastSeq > event.seq) {
        throw new Error(
          "agent cursor " + lastSeq + " is ahead of ledger event " + event.seq,
        );
      }
      const previous = state.cursors[agentId];
      if (
        previous !== undefined &&
        (revision < previous.revision ||
          (revision === previous.revision && lastSeq < previous.lastSeq))
      ) {
        throw new Error("agent cursor regressed for " + agentId);
      }
      return {
        cursors: {
          ...state.cursors,
          [agentId]: {
            agentId,
            lastSeq,
            revision,
            updatedAt: event.recordedAt,
          },
        },
      };
    },
  };
}

export function createExpectationProjection(): Projection<ExpectationState> {
  return {
    name: "expectations_current",
    version: 1,
    initial: () => ({ expectations: {} }),
    apply: (state, event) => {
      if (event.type === "expectation.registered") {
        const entry = legacyExpectationEntry(event);
        return {
          expectations: {
            ...state.expectations,
            [entry.id]: entry,
          },
        };
      }
      if (
        event.type === "expectation.created" ||
        event.type === "expectation.updated"
      ) {
        const entry = expectationEntryFromPayload(event.payload, event.seq);
        const previous = state.expectations[entry.id];
        if (event.type === "expectation.created" && previous !== undefined) {
          throw new Error(`expectation ${entry.id} was created more than once`);
        }
        if (event.type === "expectation.updated" && previous === undefined) {
          throw new Error(
            `expectation ${entry.id} was updated before creation`,
          );
        }
        return {
          expectations: {
            ...state.expectations,
            [entry.id]: {
              ...entry,
              ...(previous?.cancelled === true
                ? {
                    cancelled: true,
                    ...(previous.cancelledAt === undefined
                      ? {}
                      : { cancelledAt: previous.cancelledAt }),
                  }
                : {}),
              ...(previous?.lastVerificationRequestId === undefined
                ? {}
                : {
                    lastVerificationRequestId:
                      previous.lastVerificationRequestId,
                  }),
            },
          },
        };
      }
      if (event.type === "expectation.cancelled") {
        const payload = objectPayloadValue(
          event.payload,
          "expectation cancellation payload",
        );
        const id = requiredPayloadString(payload, "expectationId");
        const cancelledAt = requiredPayloadString(payload, "cancelledAt");
        const previous = requireExpectation(state, id);
        return {
          expectations: {
            ...state.expectations,
            [id]: {
              ...previous,
              cancelled: true,
              cancelledAt,
              lastEventSeq: event.seq,
            },
          },
        };
      }
      if (event.type === "verification.requested") {
        const payload = objectPayloadValue(
          event.payload,
          "verification request payload",
        );
        const id = requiredPayloadString(payload, "expectationId");
        const requestId = requiredPayloadString(payload, "requestId");
        const previous = requireExpectation(state, id);
        return {
          expectations: {
            ...state.expectations,
            [id]: {
              ...previous,
              lastVerificationRequestId: requestId,
              lastEventSeq: event.seq,
            },
          },
        };
      }
      if (event.type === "verification.completed") {
        const payload = objectPayloadValue(
          event.payload,
          "verification completion payload",
        );
        const result = objectPayloadValue(
          payload.result ?? null,
          "verification result payload",
        );
        const normalized = parseVerificationResult(result);
        const id = normalized.expectationId;
        const outcome = normalized.outcome;
        if (
          !(["satisfied", "violated", "unknown"] as string[]).includes(outcome)
        ) {
          throw new Error(
            `verification outcome is invalid for expectation ${id}`,
          );
        }
        const previous = requireExpectation(state, id);
        return {
          expectations: {
            ...state.expectations,
            [id]: {
              ...previous,
              status: outcome,
              updatedAt: normalized.observedAt,
              lastEventSeq: event.seq,
            },
          },
        };
      }
      if (event.type === "expectation.status.changed") {
        const payload = objectPayloadValue(
          event.payload,
          "expectation status payload",
        );
        const id = requiredPayloadString(payload, "expectationId");
        const from = requiredPayloadString(payload, "from");
        const to = requiredPayloadString(payload, "to");
        const previous = requireExpectation(state, id);
        if (previous.status !== from) {
          throw new Error(
            `expectation ${id} status changed from ${from}, current status is ${previous.status}`,
          );
        }
        const parsedStatus = expectationStatusSchema.safeParse(to);
        if (!parsedStatus.success) {
          throw new Error(`expectation ${id} status target is invalid`);
        }
        return {
          expectations: {
            ...state.expectations,
            [id]: {
              ...previous,
              status: parsedStatus.data,
              updatedAt: requiredPayloadString(payload, "changedAt"),
              lastEventSeq: event.seq,
            },
          },
        };
      }
      return state;
    },
  };
}

export function createCoreProjections(): Projection<unknown>[] {
  return [
    createProjectProjection() as unknown as Projection<unknown>,
    createRuleProjection() as unknown as Projection<unknown>,
    createAssetProjection() as unknown as Projection<unknown>,
    createAgentProjection() as unknown as Projection<unknown>,
    createExpectationProjection() as unknown as Projection<unknown>,
  ];
}

function legacyExpectationEntry(
  event: EventRecord,
): ExpectationProjectionEntry {
  const payload = objectPayloadValue(event.payload, "payload");
  const id = requiredPayloadString(payload, "expectationId");
  const createdAt = requiredPayloadString(payload, "createdAt");
  const expected = payload.expected;
  if (expected === undefined)
    throw new Error(`legacy expectation ${id} has no expected value`);
  const verification = requiredPayloadString(payload, "verification");
  return {
    id,
    ...(event.traceId === undefined ? {} : { traceId: event.traceId }),
    source: { kind: event.source.kind, id: event.source.ref ?? event.id },
    subject: objectPayloadValue(
      payload.subject ?? null,
      "legacy expectation subject",
    ) as ExpectationRecord["subject"],
    expected,
    verification: {
      mode: verification === "external" ? "external" : "state",
      criterion: expected,
    },
    createdAt,
    validFrom: createdAt,
    ...(typeof payload.validUntil === "string"
      ? { evaluateBy: payload.validUntil, expiresAt: payload.validUntil }
      : {}),
    evidence:
      (payload.evidence as unknown as ExpectationRecord["evidence"]) ?? [],
    status: "pending",
    updatedAt: event.recordedAt,
    lastEventSeq: event.seq,
  };
}

function expectationEntryFromPayload(
  payload: JsonValue,
  lastEventSeq: number,
): ExpectationProjectionEntry {
  // Structured lifecycle events use the event payload itself. The legacy
  // expectation.registered adapter is the only format with a nested payload.
  const object = objectPayloadValue(payload, "expectation lifecycle payload");
  const { materialClassification: _classification, ...record } = object;
  const entry = parseExpectationRecord(record);
  return { ...entry, lastEventSeq };
}

function objectPayloadValue(
  value: JsonValue,
  label: string,
): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, JsonValue>;
}

function requiredPayloadString(
  payload: Record<string, JsonValue>,
  key: string,
): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `expectation payload ${key} must be a non-empty string (keys: ${Object.keys(payload).join(",")})`,
    );
  }
  return value;
}

function requireExpectation(
  state: ExpectationState,
  id: string,
): ExpectationProjectionEntry {
  const previous = state.expectations[id];
  if (previous === undefined) {
    throw new Error(`expectation ${id} is not present in the projection`);
  }
  return previous;
}

function payloadString(event: EventEnvelope, key: string): string | undefined {
  if (
    event.payload === null ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const value = event.payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function jsonObject(
  value: JsonValue | undefined,
): Record<string, JsonValue> | null {
  if (value === undefined || value === null || typeof value !== "object") {
    return null;
  }
  return Array.isArray(value) ? null : value;
}

function parseProjectedAsset(
  value: JsonValue | undefined,
): ReusableAsset | null {
  if (value === undefined) return null;
  const parsed = parseReusableAsset(value);
  return parsed;
}

function legacyAssetStatus(suffix: string): string {
  const mapped: Record<string, AssetStatus> = {
    candidate: "candidate",
    validated: "validated",
    activate: "active",
    contest: "challenged",
    disable: "deprecated",
    restore: "validated",
    fork: "candidate",
  };
  return mapped[suffix] ?? suffix;
}

function assertProjectedAssetTransition(from: string, to: string): void {
  const previous = assetStatusSchema.safeParse(from);
  const next = assetStatusSchema.safeParse(to);
  if (!previous.success || !next.success || from === to) return;
  try {
    assertAssetTransition(previous.data, next.data);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

function payloadSafeInteger(
  event: EventEnvelope,
  key: string,
): number | undefined {
  if (
    event.payload === null ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const value = event.payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function epochMilliseconds(timestamp: string): number {
  const value = Date.parse(timestamp);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`invalid event timestamp: ${timestamp}`);
  }
  return value;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
