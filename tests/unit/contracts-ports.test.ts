import { describe, expect, it } from "vitest";
import type {
  Clock,
  ConfigLoader,
  IdGenerator,
  RuntimeConfig,
} from "../../packages/contracts/src/index.js";

describe("Phase 0 deterministic ports", () => {
  it("allows a deterministic clock and id generator to be injected", () => {
    const clock: Clock = {
      now: () => new Date("2026-09-13T00:00:00.000Z"),
    };
    const ids: IdGenerator = {
      next: () => "fixed-id-0001",
    };

    expect(clock.now().toISOString()).toBe("2026-09-13T00:00:00.000Z");
    expect(ids.next()).toBe("fixed-id-0001");
  });

  it("allows a typed configuration loader to be injected", () => {
    const config: RuntimeConfig = {
      schemaVersion: "1",
      dataDir: "./.praxis",
    };
    const loader: ConfigLoader = { load: () => config };

    expect(loader.load()).toEqual(config);
  });
});
