import { describe, expect, it } from "vitest";

import {
  eventEnvelopeSchema,
  parseEventEnvelope,
  stableStringify,
} from "../../packages/contracts/src/index.js";
import type {
  EventEnvelope,
  JsonObject,
} from "../../packages/contracts/src/index.js";

const validEvent: EventEnvelope = {
  schemaVersion: "1",
  eventVersion: "1",
  id: "event-1",
  type: "interaction.recorded",
  occurredAt: "2026-09-13T00:00:00.000Z",
  observedAt: "2026-09-13T00:00:01.000Z",
  recordedAt: "2026-09-13T00:00:02.000Z",
  actor: { type: "human", id: "user-1" },
  operationId: "op-1",
  source: { kind: "test", provider: "vitest", ref: "unit" },
  payload: { message: "kept", order: [2, 1] },
  provenance: { origin: "direct", confidence: 1 },
};

describe("event envelope contract", () => {
  it("accepts a canonical envelope and preserves its evidence fields", () => {
    expect(parseEventEnvelope(validEvent)).toEqual(validEvent);
  });

  it("preserves JSON object keys named __proto__ through contract parsing", () => {
    const protoObject = JSON.parse(
      '{"__proto__":{"retained":true},"safe":1}',
    ) as JsonObject;
    const parsed = parseEventEnvelope({
      ...validEvent,
      payload: protoObject,
      evidence: [
        {
          eventId: "source-event",
          origin: "direct",
          exposureInfluenced: true,
        },
      ],
      links: { derivedFrom: ["source-event"] },
      provenance: { origin: "inferred", confidence: 0.5 },
    });

    expect(parsed.payload !== null && typeof parsed.payload === "object").toBe(
      true,
    );
    expect(Object.hasOwn(parsed.payload as object, "__proto__")).toBe(true);
    expect(parsed.evidence?.[0]?.origin).toBe("direct");
    expect(parsed.links).toEqual({ derivedFrom: ["source-event"] });
    expect(parsed.provenance).toEqual({ origin: "inferred", confidence: 0.5 });
  });

  it("rejects non-canonical timestamps and unknown fields", () => {
    expect(
      eventEnvelopeSchema.safeParse({
        ...validEvent,
        occurredAt: "2026-09-13T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      eventEnvelopeSchema.safeParse({ ...validEvent, untracked: true }).success,
    ).toBe(false);
    expect(
      eventEnvelopeSchema.safeParse({
        ...validEvent,
        source: { component: "not-a-source-ref" },
      }).success,
    ).toBe(false);
    expect(
      eventEnvelopeSchema.safeParse({
        ...validEvent,
        provenance: undefined,
      }).success,
    ).toBe(false);
    expect(
      eventEnvelopeSchema.safeParse({
        ...validEvent,
        occurredAt: "2026-02-30T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("serializes object keys deterministically without changing array order", () => {
    expect(stableStringify({ b: 2, nested: { z: true, a: "x" }, a: 1 })).toBe(
      '{"a":1,"b":2,"nested":{"a":"x","z":true}}',
    );
    expect(stableStringify({ values: [2, 1] })).toBe('{"values":[2,1]}');
    const protoKeyValue = JSON.parse(
      '{"__proto__":{"retained":true},"safe":1}',
    );
    expect(stableStringify(protoKeyValue)).toBe(
      '{"__proto__":{"retained":true},"safe":1}',
    );
  });
});
