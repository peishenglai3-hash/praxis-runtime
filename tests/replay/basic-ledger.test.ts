import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  permissionScopes,
  type EventEnvelope,
  type JsonValue,
  type WriterContext,
} from "../../packages/contracts/src/index.js";
import {
  ProjectionEngine,
  createCoreProjections,
} from "../../packages/state/src/index.js";
import { SqliteEventStore } from "../../packages/store/src/index.js";

/**
 * Golden replay — Bible section 14's `tests/replay` layer.
 *
 * A fixed event stream, a projection result small enough to verify by reading
 * the reducers, and five properties that together are what "replayable"
 * means: deterministic projection, rebuild equivalence, snapshot recovery,
 * cursor recovery, and schema compatibility.
 *
 * The expected state is written in the fixture by hand from the reducer
 * source, not recorded from a run. A reducer change that alters it therefore
 * fails here and has to be explained rather than absorbed by regenerating the
 * file — which is the rule Bible section 14 states for golden fixtures.
 */

const migrationsDir = resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

const fixturePath = fileURLToPath(
  new URL("./basic-ledger.fixture.json", import.meta.url),
);

interface BasicLedgerFixture {
  name: string;
  events: EventEnvelope[];
  expected: { project: JsonValue; rules: JsonValue };
}

const fixture = JSON.parse(
  readFileSync(fixturePath, "utf8"),
) as BasicLedgerFixture;

const testWriter: WriterContext = {
  writerId: "test:replay",
  kind: "runtime",
  role: "OWNER",
  authn: "embedded-local",
  scopes: [...permissionScopes],
  policyVersion: 1,
};

let directory: string | undefined;

afterEach(() => {
  if (directory !== undefined) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    directory = undefined;
  }
});

function openStore(): SqliteEventStore {
  directory = mkdtempSync(join(tmpdir(), "praxis-replay-"));
  return new SqliteEventStore({
    filename: join(directory, "events.db"),
    migrationsDir,
  });
}

function engineFor(store: SqliteEventStore): ProjectionEngine {
  return new ProjectionEngine(store, store);
}

function stateOf(store: SqliteEventStore, name: string): JsonValue | undefined {
  return store.getProjectionState(name)?.state;
}

/** Replay the whole fixture into a fresh store, catching up as we go. */
function replayWhole(store: SqliteEventStore): void {
  for (const event of fixture.events) store.append(event, testWriter);
  const engine = engineFor(store);
  for (const projection of createCoreProjections()) engine.catchUp(projection);
}

describe("golden replay — a fixed stream produces a fixed state", () => {
  it("accepts every fixture event against the envelope contract", () => {
    // Schema compatibility: a fixture that the contract rejects is not a
    // replay fixture, it is a broken one.
    const store = openStore();
    try {
      for (const event of fixture.events) {
        expect(() => store.append(event, testWriter)).not.toThrow();
      }
      expect(store.getLastSeq()).toBe(fixture.events.length);
    } finally {
      store.close();
    }
  });

  it("reproduces the hand-computed golden state", () => {
    const store = openStore();
    try {
      replayWhole(store);
      expect(stateOf(store, "project")).toEqual(fixture.expected.project);
      expect(stateOf(store, "rules")).toEqual(fixture.expected.rules);
      // The stream contains no agent, asset or expectation event, so those
      // projections must still hold exactly their initial state. This is the
      // assertion that catches an event leaking into an unrelated reducer.
      expect(stateOf(store, "agents")).toEqual({ cursors: {} });
    } finally {
      store.close();
    }
  });

  it("is deterministic: two stores replaying the same stream agree", () => {
    const first = openStore();
    let secondDirectory: string;
    try {
      replayWhole(first);
      const firstState = stateOf(first, "rules");
      first.close();

      // A second, independent database.
      secondDirectory = mkdtempSync(join(tmpdir(), "praxis-replay-b-"));
      const second = new SqliteEventStore({
        filename: join(secondDirectory, "events.db"),
        migrationsDir,
      });
      try {
        replayWhole(second);
        expect(stateOf(second, "rules")).toEqual(firstState);
      } finally {
        second.close();
      }
    } finally {
      rmSync(secondDirectory!, { recursive: true, force: true });
    }
  });

  it("rebuilds to the same state as incremental catch-up", () => {
    const store = openStore();
    try {
      replayWhole(store);
      const incremental = createCoreProjections().map((projection) => ({
        name: projection.name,
        state: stateOf(store, projection.name),
      }));

      // Wipe every derived row and rebuild from the ledger alone.
      const engine = engineFor(store);
      for (const projection of createCoreProjections())
        engine.rebuild(projection);

      for (const entry of incremental) {
        expect(stateOf(store, entry.name)).toEqual(entry.state);
      }
    } finally {
      store.close();
    }
  });

  it("recovers a projection from a snapshot without replaying the stream", () => {
    const store = openStore();
    try {
      replayWhole(store);
      const engine = engineFor(store);
      const rules = createCoreProjections().find(
        (projection) => projection.name === "rules",
      );
      expect(rules).toBeDefined();

      // The snapshot is taken at the projection's own cursor, which after a
      // full catch-up is the ledger head the fixture occupies.
      expect(store.getProjectionState("rules")?.lastSeq).toBe(4);
      const snapshot = engine.createSnapshot(rules!);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.cursorSeq).toBe(4);

      const loaded = engine.loadSnapshot(rules!);
      expect(loaded?.cursorSeq).toBe(4);
      expect(loaded?.state).toEqual(fixture.expected.rules);
    } finally {
      store.close();
    }
  });

  it("reaches the same state whether it catches up once or in two steps", () => {
    // Cursor recovery: a process that stops after the second event and
    // resumes must land where a process that never stopped lands.
    const store = openStore();
    try {
      const engine = engineFor(store);
      const half = Math.floor(fixture.events.length / 2);

      for (const event of fixture.events.slice(0, half)) {
        store.append(event, testWriter);
      }
      for (const projection of createCoreProjections())
        engine.catchUp(projection);
      expect(store.getProjectionState("project")?.lastSeq).toBe(half);

      for (const event of fixture.events.slice(half)) {
        store.append(event, testWriter);
      }
      for (const projection of createCoreProjections())
        engine.catchUp(projection);

      expect(stateOf(store, "project")).toEqual(fixture.expected.project);
      expect(stateOf(store, "rules")).toEqual(fixture.expected.rules);
    } finally {
      store.close();
    }
  });
});
