export {};
import type {
  EventEnvelope,
  EventReader,
  EventRecord,
  JsonValue,
  ProjectionDataRecord,
  ProjectionPersistence,
  ProjectionStateRecord,
  SnapshotRecord,
} from "@praxis/contracts";

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
    if (eventSeq !== previousSeq + 1) {
      throw new Error(
        "event sequence is not contiguous: expected " +
          (previousSeq + 1) +
          ", found " +
          eventSeq,
      );
    }
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
    version: 1,
    initial: () => ({ assets: {} }),
    apply: (state, event) => {
      if (!event.type.startsWith("asset.")) return state;
      const id = payloadString(event, "id") ?? event.id;
      const revision = payloadSafeInteger(event, "revision");
      const previous = state.assets[id];
      const entry: AssetProjectionEntry = {
        id,
        status: event.type.slice("asset.".length),
        lastSeq: event.seq,
      };
      if (revision !== undefined) entry.revision = revision;
      else if (previous?.revision !== undefined)
        entry.revision = previous.revision;
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

export function createCoreProjections(): Projection<unknown>[] {
  return [
    createProjectProjection() as unknown as Projection<unknown>,
    createRuleProjection() as unknown as Projection<unknown>,
    createAssetProjection() as unknown as Projection<unknown>,
    createAgentProjection() as unknown as Projection<unknown>,
  ];
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
