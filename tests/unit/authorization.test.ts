import { describe, expect, it } from "vitest";

import {
  AuthorizationError,
  authorizeHumanControl,
  authorizeEventAppend,
  permissionScopes,
  requiredScopeForEventType,
  type WriterContext,
} from "../../packages/contracts/src/index.js";

const allScopes = [...permissionScopes];

const writer = (overrides: Partial<WriterContext> = {}): WriterContext => ({
  writerId: "test:writer",
  kind: "runtime",
  role: "OWNER",
  authn: "embedded-local",
  scopes: allScopes,
  policyVersion: 1,
  ...overrides,
});

describe("WriterContext capability authorization", () => {
  it("maps event families to explicit scopes", () => {
    expect(requiredScopeForEventType("interaction.recorded")).toBe(
      "event.append",
    );
    expect(requiredScopeForEventType("residual.detected")).toBe(
      "residual.propose",
    );
    expect(requiredScopeForEventType("asset.activate")).toBe("asset.activate");
    expect(requiredScopeForEventType("privacy.purge.completed")).toBe(
      "history.purge",
    );
  });

  it("rejects scope omissions before any event is written", () => {
    expect(() =>
      authorizeEventAppend(
        writer({ scopes: ["event.read"] }),
        "interaction.recorded",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTHORIZATION_ERROR",
        details: expect.objectContaining({ requiredScope: "event.append" }),
      }),
    );
  });

  it("keeps importer and adapter namespaces separate", () => {
    expect(() =>
      authorizeEventAppend(
        writer({ kind: "adapter", role: "ADAPTER" }),
        "legacy.imported",
      ),
    ).toThrowError(AuthorizationError);
    expect(() =>
      authorizeEventAppend(
        writer({ kind: "importer", role: "IMPORTER" }),
        "interaction.recorded",
      ),
    ).toThrowError(AuthorizationError);
  });

  it("does not let analysis roles activate assets", () => {
    expect(() =>
      authorizeEventAppend(writer({ role: "ANALYZER" }), "asset.activate"),
    ).toThrowError(AuthorizationError);
  });

  it("requires a human OWNER for irreversible control decisions", () => {
    expect(() =>
      authorizeHumanControl(
        writer({ kind: "runtime", role: "OWNER" }),
        "privacy purge",
        "history.purge",
      ),
    ).toThrowError(AuthorizationError);
    expect(() =>
      authorizeHumanControl(
        writer({ kind: "human", role: "OBSERVER" }),
        "privacy purge",
        "history.purge",
      ),
    ).toThrowError(AuthorizationError);
    expect(
      authorizeHumanControl(
        writer({ kind: "human", role: "OWNER" }),
        "purge",
        "history.purge",
      ).role,
    ).toBe("OWNER");
  });

  it("enforces the bounded role namespaces", () => {
    expect(() =>
      authorizeEventAppend(
        writer({ role: "OBSERVER", scopes: ["event.append"] }),
        "asset.candidate",
      ),
    ).toThrowError(AuthorizationError);
    expect(() =>
      authorizeEventAppend(
        writer({ role: "VERIFIER", scopes: ["event.append"] }),
        "interaction.recorded",
      ),
    ).toThrowError(AuthorizationError);
    expect(() =>
      authorizeEventAppend(
        writer({ role: "ANALYZER", scopes: ["residual.propose"] }),
        "residual.detected",
      ),
    ).not.toThrow();
  });
});
