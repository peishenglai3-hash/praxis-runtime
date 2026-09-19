import type { ClassifiedError } from "./errors.js";

/**
 * Output contract.
 *
 * Under `--json`, stdout carries exactly one machine document and nothing
 * else: a caller can pipe it straight into a parser. Human-readable
 * diagnostics — including the error document — go to stderr. Without
 * `--json`, stdout carries a readable summary and stderr stays quiet unless
 * something failed.
 *
 * Every machine document declares a `schemaVersion`, so a consumer can refuse
 * a shape it does not understand instead of mis-reading a newer one.
 */

export const outputSchemaVersion = "1";

export interface CommandOutcome {
  /** Machine-readable result. Must be JSON-serializable. */
  data: unknown;
  /** Human-readable summary lines. */
  lines: string[];
}

export interface OutputSink {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const processSink: OutputSink = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export function renderSuccess(
  command: string,
  outcome: CommandOutcome,
  json: boolean,
  sink: OutputSink,
): void {
  if (json) {
    sink.stdout(
      `${JSON.stringify(
        {
          schemaVersion: outputSchemaVersion,
          command,
          ok: true,
          result: outcome.data,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  sink.stdout(`${outcome.lines.join("\n")}\n`);
}

export function renderFailure(
  classified: ClassifiedError,
  json: boolean,
  sink: OutputSink,
): void {
  if (json) {
    sink.stderr(
      `${JSON.stringify(
        {
          schemaVersion: outputSchemaVersion,
          ok: false,
          error: classified.error,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const details =
    classified.error.details === undefined
      ? ""
      : `\n  details: ${JSON.stringify(classified.error.details)}`;
  sink.stderr(
    `error: ${classified.error.message}` +
      `\n  code: ${classified.error.code}` +
      `\n  trace: ${classified.error.traceId}` +
      `\n  next: ${classified.error.suggestedAction}${details}\n`,
  );
}
