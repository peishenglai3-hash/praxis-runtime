import { z } from "zod";

export const permissionScopes = [
  "event.read",
  "event.append",
  "state.read",
  "residual.propose",
  "tool.execute",
  "asset.propose",
  "asset.activate",
  "asset.contest",
  "asset.disable",
  "asset.fork",
  "history.export",
  "history.purge",
  "system.migrate",
] as const;

export type PermissionScope = (typeof permissionScopes)[number];

export type WriterKind = "human" | "runtime" | "agent" | "adapter" | "importer";

export type WriterAuthn = "embedded-local" | "daemon-token" | "system";

export const writerRoles = [
  "OWNER",
  "OBSERVER",
  "ANALYZER",
  "VERIFIER",
  "COORDINATOR",
  "ADAPTER",
  "IMPORTER",
  "MIGRATION",
] as const;

export type WriterRole = (typeof writerRoles)[number];

export interface WriterContext {
  writerId: string;
  kind: WriterKind;
  role: WriterRole;
  authn: WriterAuthn;
  scopes: PermissionScope[];
  policyVersion: number;
}

function freezeWriterContext(value: WriterContext): WriterContext {
  return Object.freeze({
    ...value,
    scopes: Object.freeze([...value.scopes]),
  }) as unknown as WriterContext;
}

export const writerContextSchema = z
  .object({
    writerId: z.string().min(1),
    kind: z.enum(["human", "runtime", "agent", "adapter", "importer"]),
    role: z.enum(writerRoles),
    authn: z.enum(["embedded-local", "daemon-token", "system"]),
    scopes: z.array(z.enum(permissionScopes)).min(1),
    policyVersion: z.literal(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.scopes).size !== value.scopes.length) {
      context.addIssue({
        code: "custom",
        path: ["scopes"],
        message: "writer scopes must not contain duplicates",
      });
    }
    if (
      value.kind === "runtime" &&
      value.authn !== "system" &&
      value.role === "MIGRATION"
    ) {
      context.addIssue({
        code: "custom",
        path: ["authn"],
        message: "MIGRATION runtime writers require system authentication",
      });
    }
  });

export const migrationWriterContext: WriterContext = freezeWriterContext({
  writerId: "system:migration",
  kind: "runtime",
  role: "MIGRATION",
  authn: "system",
  scopes: ["system.migrate"],
  policyVersion: 1,
});

export class AuthorizationError extends Error {
  readonly code = "AUTHORIZATION_ERROR" as const;
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "AuthorizationError";
    this.details = details;
  }
}

export function parseWriterContext(value: unknown): WriterContext {
  return freezeWriterContext(writerContextSchema.parse(value) as WriterContext);
}

export function validateWriterContext(value: unknown): WriterContext {
  const parsed = writerContextSchema.safeParse(value);
  if (!parsed.success) {
    throw new AuthorizationError(
      "WriterContext failed authorization validation",
      {
        issues: parsed.error.issues,
      },
    );
  }
  return freezeWriterContext(parsed.data as WriterContext);
}

export function authorizeWriterScope(
  writerInput: unknown,
  requiredScope: PermissionScope,
  action = "operation",
): WriterContext {
  const writer = validateWriterContext(writerInput);
  if (!writer.scopes.includes(requiredScope)) {
    throw new AuthorizationError("writer lacks the required capability scope", {
      writerId: writer.writerId,
      role: writer.role,
      action,
      requiredScope,
    });
  }
  return writer;
}

export function authorizeHumanControl(
  writerInput: unknown,
  action: string,
  requiredScope: PermissionScope,
): WriterContext {
  const writer = authorizeWriterScope(writerInput, requiredScope, action);
  if (writer.kind !== "human" || writer.role.toUpperCase() !== "OWNER") {
    throw new AuthorizationError(
      "human control requires a human OWNER writer",
      {
        writerId: writer.writerId,
        role: writer.role,
        action,
      },
    );
  }
  return writer;
}

export function requiredScopeForEventType(type: string): PermissionScope {
  if (type === "asset.invalidated") return "history.purge";
  if (type === "asset.activate") return "asset.activate";
  if (type === "asset.contest") return "asset.contest";
  if (type === "asset.disable") return "asset.disable";
  if (type === "asset.fork") return "asset.fork";
  if (type.startsWith("asset.")) return "asset.propose";
  if (type.startsWith("tool.")) return "tool.execute";
  if (type === "residual.detected" || type === "reflection.proposed") {
    return "residual.propose";
  }
  if (type === "history.export") return "history.export";
  if (type.startsWith("privacy.") || type === "history.purge") {
    return "history.purge";
  }
  if (type.startsWith("system.")) return "system.migrate";
  return "event.append";
}

export function authorizeEventAppend(
  writerInput: unknown,
  type: string,
): WriterContext {
  const writer = validateWriterContext(writerInput);
  const requiredScope = requiredScopeForEventType(type);
  if (!writer.scopes.includes(requiredScope)) {
    throw new AuthorizationError("writer lacks the required event scope", {
      writerId: writer.writerId,
      role: writer.role,
      eventType: type,
      requiredScope,
    });
  }

  const role = writer.role.toUpperCase();
  if (
    [
      "asset.activate",
      "asset.contest",
      "asset.disable",
      "asset.fork",
      "asset.restore",
      "asset.invalidated",
      "expectation.cancelled",
      "expectation.status.changed",
    ].includes(type) &&
    (writer.kind !== "human" || role !== "OWNER")
  ) {
    throw new AuthorizationError("this event requires a human OWNER writer", {
      writerId: writer.writerId,
      role: writer.role,
      eventType: type,
    });
  }
  if (
    type.startsWith("legacy.") &&
    writer.kind !== "importer" &&
    role !== "OWNER"
  ) {
    throw new AuthorizationError("legacy events require an importer writer", {
      writerId: writer.writerId,
      eventType: type,
    });
  }
  if (writer.kind === "adapter" && type.startsWith("legacy.")) {
    throw new AuthorizationError(
      "adapter writers cannot append legacy events",
      {
        writerId: writer.writerId,
        eventType: type,
      },
    );
  }
  if (writer.kind === "importer" && !type.startsWith("legacy.")) {
    throw new AuthorizationError(
      "importer writers can only append legacy events",
      {
        writerId: writer.writerId,
        eventType: type,
      },
    );
  }
  if (
    ["ANALYZER", "VERIFIER", "COORDINATOR", "ADAPTER", "IMPORTER"].includes(
      role,
    ) &&
    type === "asset.activate"
  ) {
    throw new AuthorizationError("this writer role cannot activate assets", {
      writerId: writer.writerId,
      role: writer.role,
      eventType: type,
    });
  }
  const namespaceAllowed =
    role === "OWNER" ||
    (role === "OBSERVER" &&
      (type.startsWith("observation.") || type.startsWith("feedback."))) ||
    (role === "ANALYZER" &&
      (type.startsWith("analysis.") ||
        type === "residual.detected" ||
        type === "reflection.proposed" ||
        type === "asset.candidate")) ||
    (role === "VERIFIER" && type.startsWith("verification.")) ||
    (role === "COORDINATOR" &&
      (type.startsWith("coordination.") ||
        type.startsWith("context.") ||
        type === "verification.requested" ||
        type.startsWith("tool."))) ||
    (role === "ADAPTER" &&
      (type.startsWith("adapter.") || type.startsWith("interaction."))) ||
    (role === "IMPORTER" && type.startsWith("legacy."));
  if (
    [
      "OBSERVER",
      "ANALYZER",
      "VERIFIER",
      "COORDINATOR",
      "ADAPTER",
      "IMPORTER",
    ].includes(role) &&
    !namespaceAllowed
  ) {
    throw new AuthorizationError(
      "writer is outside its authorized event namespace",
      {
        writerId: writer.writerId,
        role: writer.role,
        eventType: type,
      },
    );
  }
  return writer;
}
