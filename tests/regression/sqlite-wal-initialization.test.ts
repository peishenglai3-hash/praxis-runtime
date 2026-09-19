import { describe, expect, it } from "vitest";

import { retrySqliteBusy } from "../../packages/store/src/sqlite.js";

function sqliteError(
  message: string,
  errcode = 5,
): Error & {
  code: string;
  errcode: number;
} {
  const error = new Error(message) as Error & {
    code: string;
    errcode: number;
  };
  error.code = "ERR_SQLITE_ERROR";
  error.errcode = errcode;
  return error;
}

describe("SQLite WAL initialization retry", () => {
  it("retries a transient busy transition and then returns its result", () => {
    let attempts = 0;

    const result = retrySqliteBusy(() => {
      attempts += 1;
      if (attempts < 3) throw sqliteError("database is locked");
      return "ready";
    });

    expect(result).toBe("ready");
    expect(attempts).toBe(3);
  });

  it("does not turn a non-busy SQLite error into a retry", () => {
    let attempts = 0;
    const error = sqliteError("near WAL: syntax error", 1);

    expect(() =>
      retrySqliteBusy(() => {
        attempts += 1;
        throw error;
      }),
    ).toThrow(error);
    expect(attempts).toBe(1);
  });

  it("fails closed after the bounded busy retry budget", () => {
    let attempts = 0;

    expect(() =>
      retrySqliteBusy(() => {
        attempts += 1;
        throw sqliteError("database is locked");
      }),
    ).toThrow("database is locked");
    expect(attempts).toBe(8);
  });
});
