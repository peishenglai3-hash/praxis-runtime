import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  AssetPromotionPolicyConfig,
  LegacyPrivacyRule,
} from "@praxis/contracts";

import { CliError } from "./errors.js";

/**
 * Operator configuration.
 *
 * The file is versioned and strict: an unknown field is a configuration error
 * rather than something to ignore, because a misspelled key on a runtime that
 * writes to a ledger is more likely to be a mistake with consequences than an
 * intentional extension. Secrets never belong here; provider credentials are
 * read from the environment.
 */

export const praxisConfigSchemaVersion = "1";

export interface PraxisConfig {
  schemaVersion: "1";
  dataDir?: string;
  migrationsDir?: string;
  backupsDir?: string;
  legacyArchiveRoot?: string;
  legacyPrivacyRules?: LegacyPrivacyRule[];
  actor?: { type: "human" | "model" | "agent" | "tool" | "system"; id: string };
  actorId?: string;
  writerId?: string;
  promotionPolicy?: AssetPromotionPolicyConfig;
}

export interface LoadedConfig {
  /** Absolute path of the file that was read, or `null` for defaults. */
  path: string | null;
  config: PraxisConfig;
  /** Digest of the file's bytes, or of the defaults when no file was read. */
  hash: string;
}

export const praxisConfigFields = [
  "schemaVersion",
  "dataDir",
  "migrationsDir",
  "backupsDir",
  "legacyArchiveRoot",
  "legacyPrivacyRules",
  "actor",
  "actorId",
  "writerId",
  "promotionPolicy",
] as const;

const knownKeys = new Set<string>(praxisConfigFields);

export function loadConfig(
  explicitPath: string | undefined,
  env: Record<string, string | undefined>,
  cwd: string,
): LoadedConfig {
  const candidate =
    explicitPath ?? env["PRAXIS_CONFIG"] ?? resolve(cwd, "praxis.config.json");
  if (!existsSync(candidate)) {
    if (explicitPath !== undefined) {
      throw new CliError(
        "CONFIG_ERROR",
        `configuration file not found: ${explicitPath}`,
      );
    }
    return {
      path: null,
      config: { schemaVersion: "1" },
      hash: digest("defaults"),
    };
  }

  const raw = readFileSync(candidate);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (error) {
    throw new CliError("CONFIG_ERROR", `${candidate} is not valid JSON`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    path: candidate,
    config: validateConfig(parsed, candidate),
    hash: digest(raw.toString("utf8")),
  };
}

/**
 * Fields the CLI honours today. The remaining knobs the Bible lists under
 * configuration — context ranking weights, reflection budgets, timing-residual
 * thresholds — are still package defaults because threading them would change
 * the verified Phase 2-4 constructor boundaries. They are recorded as an open
 * gap in the Phase 5 gate rather than being silently claimed.
 */
export function validateConfig(value: unknown, source: string): PraxisConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliError("CONFIG_ERROR", `${source} must contain a JSON object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !knownKeys.has(key));
  if (unknown.length > 0) {
    throw new CliError(
      "CONFIG_ERROR",
      `${source} contains unknown field(s): ${unknown.join(", ")}`,
      { knownFields: [...knownKeys].sort() },
    );
  }
  if (record["schemaVersion"] !== praxisConfigSchemaVersion) {
    throw new CliError(
      "CONFIG_ERROR",
      `${source} must declare schemaVersion "${praxisConfigSchemaVersion}"`,
      { received: record["schemaVersion"] ?? null },
    );
  }

  const config: PraxisConfig = { schemaVersion: "1" };
  for (const key of [
    "dataDir",
    "migrationsDir",
    "backupsDir",
    "legacyArchiveRoot",
    "actorId",
    "writerId",
  ] as const) {
    const field = record[key];
    if (field === undefined) continue;
    if (typeof field !== "string" || field.length === 0) {
      throw new CliError(
        "CONFIG_ERROR",
        `${source}.${key} must be a non-empty string`,
      );
    }
    config[key] = field;
  }

  const actor = record["actor"];
  if (actor !== undefined) {
    if (typeof actor !== "object" || actor === null || Array.isArray(actor)) {
      throw new CliError("CONFIG_ERROR", `${source}.actor must be an object`);
    }
    const actorRecord = actor as Record<string, unknown>;
    const type = actorRecord["type"];
    const id = actorRecord["id"];
    if (
      typeof type !== "string" ||
      !["human", "model", "agent", "tool", "system"].includes(type) ||
      typeof id !== "string" ||
      id.length === 0
    ) {
      throw new CliError(
        "CONFIG_ERROR",
        `${source}.actor must be { type, id } with a known actor type`,
      );
    }
    config.actor = { type: type as "human", id };
  }

  const rules = record["legacyPrivacyRules"];
  if (rules !== undefined) {
    if (!Array.isArray(rules)) {
      throw new CliError(
        "CONFIG_ERROR",
        `${source}.legacyPrivacyRules must be an array`,
      );
    }
    config.legacyPrivacyRules = rules.map((entry, index) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new CliError(
          "CONFIG_ERROR",
          `${source}.legacyPrivacyRules[${index}] must be an object`,
        );
      }
      const rule = entry as Record<string, unknown>;
      for (const field of ["ruleId", "pathPrefix", "reason"] as const) {
        if (
          typeof rule[field] !== "string" ||
          (rule[field] as string).length === 0
        ) {
          throw new CliError(
            "CONFIG_ERROR",
            `${source}.legacyPrivacyRules[${index}].${field} must be a non-empty string`,
          );
        }
      }
      return {
        ruleId: rule["ruleId"] as string,
        pathPrefix: rule["pathPrefix"] as string,
        reason: rule["reason"] as string,
      };
    });
  }

  const policy = record["promotionPolicy"];
  if (policy !== undefined) {
    if (
      typeof policy !== "object" ||
      policy === null ||
      Array.isArray(policy)
    ) {
      throw new CliError(
        "CONFIG_ERROR",
        `${source}.promotionPolicy must be an object`,
      );
    }
    const policyRecord = policy as Record<string, unknown>;
    for (const field of [
      "minimumEvidence",
      "minimumIndependentEpisodes",
    ] as const) {
      const number = policyRecord[field];
      if (!Number.isSafeInteger(number) || (number as number) < 1) {
        throw new CliError(
          "CONFIG_ERROR",
          `${source}.promotionPolicy.${field} must be a positive integer`,
        );
      }
    }
    config.promotionPolicy = {
      minimumEvidence: policyRecord["minimumEvidence"] as number,
      minimumIndependentEpisodes: policyRecord[
        "minimumIndependentEpisodes"
      ] as number,
    };
  }

  return config;
}

/**
 * Digest of everything in the file. Only this digest, never the file's
 * contents, is written to the ledger, so a configuration change is auditable
 * without recording anything that might carry an operator path or a value the
 * operator did not intend to publish.
 */
function digest(value: string): string {
  // A small deterministic digest; the ledger's own hashing is not needed here
  // because this value only has to detect change.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/** The safe subset recorded in `system.config.changed`. */
export function configAuditFields(
  loaded: LoadedConfig,
): Record<string, unknown> {
  const config = loaded.config;
  return {
    configPath: loaded.path === null ? null : "<configured>",
    configHash: loaded.hash,
    hasDataDir: config.dataDir !== undefined,
    hasMigrationsDir: config.migrationsDir !== undefined,
    hasBackupsDir: config.backupsDir !== undefined,
    hasLegacyArchiveRoot: config.legacyArchiveRoot !== undefined,
    legacyPrivacyRuleCount: config.legacyPrivacyRules?.length ?? 0,
    actorType: config.actor?.type ?? null,
    promotionPolicy:
      config.promotionPolicy === undefined
        ? null
        : {
            minimumEvidence: config.promotionPolicy.minimumEvidence,
            minimumIndependentEpisodes:
              config.promotionPolicy.minimumIndependentEpisodes,
          },
  };
}
