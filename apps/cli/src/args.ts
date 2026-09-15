import { CliError } from "./errors.js";

/**
 * Argument parsing for the Praxis command line.
 *
 * The grammar is deliberately small and closed: a command path of one or two
 * known words, then flags, then positionals. An unknown command or flag is a
 * usage error rather than something to guess at, because a silently ignored
 * flag on a command that writes to the ledger is worse than a refusal.
 */

export const subcommandsByCommand: Record<string, readonly string[]> = {
  projection: ["rebuild", "show"],
  event: ["append", "list"],
  state: ["show"],
  context: ["plan"],
  residual: ["list"],
  reflection: ["run"],
  asset: [
    "list",
    "inspect",
    "contest",
    "disable",
    "restore",
    "fork",
    "activate",
  ],
  history: ["explain"],
  legacy: ["import", "runs", "anomalies"],
  privacy: ["purge"],
  backup: ["create", "list", "restore"],
  lock: ["inspect", "clear-stale"],
};

/** Commands that take no subcommand. */
export const bareCommands = ["init", "doctor", "rebuild", "export"] as const;

export interface ParsedCommand {
  /** The full command path, for example `["asset", "inspect"]`. */
  path: string[];
  command: string;
  subcommand?: string;
  positionals: string[];
  flags: Map<string, string | true>;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): ParsedCommand {
  const tokens = [...argv];
  if (tokens.length === 0) {
    throw new CliError("USAGE_ERROR", "no command was given");
  }

  const command = tokens[0] ?? "";
  if (command.startsWith("-")) {
    throw new CliError(
      "USAGE_ERROR",
      `expected a command, received ${command}`,
    );
  }

  let subcommand: string | undefined;
  const remaining = tokens.slice(1);
  if ((bareCommands as readonly string[]).includes(command)) {
    // No subcommand.
  } else {
    const allowed = subcommandsByCommand[command];
    if (allowed === undefined) {
      throw new CliError("USAGE_ERROR", `unknown command ${command}`);
    }
    const candidate = remaining[0];
    if (candidate === undefined || candidate.startsWith("-")) {
      throw new CliError(
        "USAGE_ERROR",
        `${command} requires a subcommand (${allowed.join(", ")})`,
      );
    }
    if (!allowed.includes(candidate)) {
      throw new CliError(
        "USAGE_ERROR",
        `unknown subcommand ${command} ${candidate}; expected one of ${allowed.join(", ")}`,
      );
    }
    subcommand = candidate;
    remaining.shift();
  }

  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  let flagsEnded = false;

  for (let index = 0; index < remaining.length; index += 1) {
    const token = remaining[index] ?? "";
    if (flagsEnded) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      flagsEnded = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const separator = body.indexOf("=");
    if (separator >= 0) {
      const name = body.slice(0, separator);
      flags.set(name, body.slice(separator + 1));
      continue;
    }
    const next = remaining[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(body, next);
      index += 1;
      continue;
    }
    flags.set(body, true);
  }

  return {
    path: subcommand === undefined ? [command] : [command, subcommand],
    command,
    ...(subcommand === undefined ? {} : { subcommand }),
    positionals,
    flags,
    json: flags.has("json"),
    help: flags.has("help"),
  };
}

export function requireFlag(parsed: ParsedCommand, name: string): string {
  const value = parsed.flags.get(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError(
      "USAGE_ERROR",
      `${parsed.path.join(" ")} requires --${name} <value>`,
    );
  }
  return value;
}

export function optionalFlag(
  parsed: ParsedCommand,
  name: string,
): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function booleanFlag(parsed: ParsedCommand, name: string): boolean {
  return parsed.flags.get(name) !== undefined;
}

export function requirePositional(
  parsed: ParsedCommand,
  index: number,
  label: string,
): string {
  const value = parsed.positionals[index];
  if (value === undefined || value.length === 0) {
    throw new CliError(
      "USAGE_ERROR",
      `${parsed.path.join(" ")} requires a ${label}`,
    );
  }
  return value;
}

/**
 * Parse a JSON argument. A malformed value is a validation failure with the
 * original text preserved, because the caller's next step is to fix the text
 * rather than to read a generic parse error.
 */
export function parseJsonArgument(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new CliError("VALIDATION_ERROR", `${label} is not valid JSON`, {
      received: raw,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
