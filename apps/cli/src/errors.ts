import { randomUUID } from "node:crypto";

/**
 * The CLI's stable contract with an automated caller.
 *
 * A command's observable behaviour is its exit code and (under `--json`) the
 * machine document it writes to stdout. Both are frozen here so that a
 * wrapper script can branch on them without parsing human prose, and so that a
 * new failure mode has to be assigned a deliberate code rather than inheriting
 * a generic one.
 */

export const exitCodes = {
  success: 0,
  validation: 2,
  config: 3,
  migration: 4,
  storage: 5,
  invariant: 6,
  adapter: 7,
  permission: 8,
} as const;

export type CliExitCode = (typeof exitCodes)[keyof typeof exitCodes];

export type CliErrorCode =
  | "USAGE_ERROR"
  | "CONFIG_ERROR"
  | "VALIDATION_ERROR"
  | "MIGRATION_ERROR"
  | "STORAGE_ERROR"
  | "INVARIANT_VIOLATION"
  | "EXTERNAL_ADAPTER_ERROR"
  | "PERMISSION_ERROR";

export interface CliErrorShape {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  traceId: string;
  suggestedAction: string;
}

export interface ClassifiedError {
  exitCode: CliExitCode;
  error: CliErrorShape;
}

/** An error the CLI itself raised, with its code already chosen. */
export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: CliErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.details = details;
  }
}

const exitCodeByCliCode: Record<CliErrorCode, CliExitCode> = {
  USAGE_ERROR: exitCodes.validation,
  CONFIG_ERROR: exitCodes.config,
  VALIDATION_ERROR: exitCodes.validation,
  MIGRATION_ERROR: exitCodes.migration,
  STORAGE_ERROR: exitCodes.storage,
  INVARIANT_VIOLATION: exitCodes.invariant,
  EXTERNAL_ADAPTER_ERROR: exitCodes.adapter,
  PERMISSION_ERROR: exitCodes.permission,
};

/**
 * Map an error raised anywhere in the stack onto an exit code and a stable
 * error document.
 *
 * The source error's own `code` is preserved rather than replaced, so a caller
 * can distinguish `ASSET_REVISION_CONFLICT` from `EVENT_ID_CONFLICT` even
 * though both are validation-class failures. An unrecognised error is reported
 * as a storage-class failure with the original text kept in `details`, rather
 * than being smoothed into a generic message.
 */
export function classifyError(
  error: unknown,
  traceId: string,
): ClassifiedError {
  const sourceCode = readString(error, "code");
  const details = readDetails(error);
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof CliError) {
    return {
      exitCode: exitCodeByCliCode[error.code],
      error: {
        code: error.code,
        message,
        ...(Object.keys(error.details).length === 0
          ? {}
          : { details: error.details }),
        traceId,
        suggestedAction: suggestAction(error.code, sourceCode),
      },
    };
  }

  const mapped = mapSourceCode(sourceCode);
  return {
    exitCode: mapped.exitCode,
    error: {
      code: sourceCode ?? mapped.cliCode,
      message,
      ...(details === undefined ? {} : { details }),
      traceId,
      suggestedAction: suggestAction(mapped.cliCode, sourceCode),
    },
  };
}

function mapSourceCode(sourceCode: string | undefined): {
  exitCode: CliExitCode;
  cliCode: CliErrorCode;
} {
  switch (sourceCode) {
    case "AUTHORIZATION_ERROR":
      return {
        exitCode: exitCodes.permission,
        cliCode: "PERMISSION_ERROR",
      };
    case "MIGRATION_ERROR":
      return { exitCode: exitCodes.migration, cliCode: "MIGRATION_ERROR" };
    case "INVALID_EVENT":
      return { exitCode: exitCodes.validation, cliCode: "VALIDATION_ERROR" };
    case "UNKNOWN_PROJECTION":
      return { exitCode: exitCodes.validation, cliCode: "VALIDATION_ERROR" };
    case "EVENT_ID_CONFLICT":
    case "OPERATION_ID_CONFLICT":
    case "ASSET_REVISION_CONFLICT":
      return { exitCode: exitCodes.validation, cliCode: "VALIDATION_ERROR" };
    case "ASSET_WRITE_REQUIRED":
    case "ASSET_LIFECYCLE_ERROR":
    case "LEGACY_PLAN_MISMATCH":
      return {
        exitCode: exitCodes.invariant,
        cliCode: "INVARIANT_VIOLATION",
      };
    case "LEGACY_ARCHIVE_UNCONFIGURED":
      return { exitCode: exitCodes.config, cliCode: "CONFIG_ERROR" };
    case "WRITER_LOCK_CONFLICT":
    case "STORAGE_ERROR":
    case "LEGACY_ARCHIVE_ERROR":
      return { exitCode: exitCodes.storage, cliCode: "STORAGE_ERROR" };
    default:
      return { exitCode: exitCodes.storage, cliCode: "STORAGE_ERROR" };
  }
}

function suggestAction(
  cliCode: CliErrorCode,
  sourceCode: string | undefined,
): string {
  switch (sourceCode) {
    case "AUTHORIZATION_ERROR":
      return "run the command with a writer that holds the required scope";
    case "WRITER_LOCK_CONFLICT":
      return "inspect the writer lock, then stop the other process or clear a stale lock";
    case "ASSET_REVISION_CONFLICT":
      return "re-read the asset and retry with its current revision";
    case "MIGRATION_ERROR":
      return "inspect the migration status and the failing migration before retrying";
    case "LEGACY_PLAN_MISMATCH":
      return "re-run the dry run and confirm the plan hash it printed";
    default:
      break;
  }
  switch (cliCode) {
    case "USAGE_ERROR":
      return "run the command with --help to see its arguments";
    case "CONFIG_ERROR":
      return "check praxis.config.json against schemas/praxis-config.v1.schema.json";
    case "INVARIANT_VIOLATION":
      return "check docs/RFC/RFC-0001.md for the boundary this command crossed";
    case "EXTERNAL_ADAPTER_ERROR":
      return "check the adapter configuration and retry";
    case "PERMISSION_ERROR":
      return "check the writer scopes and the human-control requirements";
    case "VALIDATION_ERROR":
      return "inspect the reported payload or argument and retry";
    case "MIGRATION_ERROR":
      return "run doctor and inspect the migration status";
    default:
      return "run doctor and inspect the reported details";
  }
}

function readString(error: unknown, key: string): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readDetails(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>)["details"];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function newTraceId(): string {
  return randomUUID();
}
