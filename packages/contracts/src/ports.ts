import type { JsonValue } from "./json.js";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface TokenBudgetEstimator {
  estimate(text: string, modelHint?: string): number;
}

export interface RuntimeConfig {
  schemaVersion: "1";
  dataDir: string;
}

export interface ConfigLoader<TConfig extends RuntimeConfig = RuntimeConfig> {
  load(): TConfig;
}

export interface ProjectionStateRecord {
  projectionName: string;
  projectionVersion: number;
  lastSeq: number;
  state: JsonValue;
  updatedAt: number;
}

export interface ProjectionDataRecord {
  projectionName: string;
  entityKey: string;
  projectionVersion: number;
  lastSeq: number;
  state: JsonValue;
  updatedAt: number;
}

export interface SnapshotRecord {
  id: string;
  projectionName: string;
  projectionVersion: number;
  cursorSeq: number;
  state: JsonValue;
  createdAt: number;
}

export interface ProjectionPersistence {
  getProjectionState(projectionName: string): ProjectionStateRecord | null;
  saveProjectionState(
    record: ProjectionStateRecord,
    expectedLastSeq?: number,
  ): void;
  replaceProjection(
    record: ProjectionStateRecord,
    data: ProjectionDataRecord[],
  ): void;
  clearProjectionData(projectionName: string): void;
  getSnapshot(
    projectionName: string,
    projectionVersion: number,
  ): SnapshotRecord | null;
  saveSnapshot(record: SnapshotRecord): void;
}
