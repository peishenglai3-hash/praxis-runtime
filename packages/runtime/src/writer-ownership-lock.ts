import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { resolve } from "node:path";

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM" || code === "EACCES";
  }
}

export type RuntimeMode = "embedded" | "daemon";

export interface WriterLockMetadata {
  pid: number;
  mode: RuntimeMode;
  startedAt: string;
  dbPath: string;
}

export interface WriterLockRecord extends WriterLockMetadata {
  token: string;
}

export class WriterLockError extends Error {
  readonly code = "WRITER_LOCK_CONFLICT" as const;

  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WriterLockError";
  }
}

export class WriterOwnershipLock {
  readonly path: string;
  #token: string | undefined;

  constructor(path: string) {
    this.path = resolve(path);
  }

  inspect(): WriterLockRecord | null {
    if (!existsSync(this.path)) return null;
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as Record<
        string,
        unknown
      >;
      if (
        typeof value.token !== "string" ||
        typeof value.pid !== "number" ||
        !Number.isSafeInteger(value.pid) ||
        (value.mode !== "embedded" && value.mode !== "daemon") ||
        typeof value.startedAt !== "string" ||
        typeof value.dbPath !== "string"
      ) {
        return null;
      }
      return {
        token: value.token,
        pid: value.pid,
        mode: value.mode,
        startedAt: value.startedAt,
        dbPath: value.dbPath,
      };
    } catch {
      return null;
    }
  }

  clearStale(expectedToken: string): boolean {
    const record = this.inspect();
    if (record === null) return false;
    if (record.token !== expectedToken) {
      throw new WriterLockError(
        "writer lock token does not match the requested stale-lock clear",
        { path: this.path },
      );
    }
    if (record.pid === process.pid || isProcessAlive(record.pid)) {
      throw new WriterLockError(
        "writer lock is still owned by a live process; it was preserved",
        { path: this.path, pid: record.pid },
      );
    }
    unlinkSync(this.path);
    return true;
  }

  acquire(metadata: WriterLockMetadata): void {
    if (this.#token !== undefined) return;
    const token = randomUUID();
    const record = JSON.stringify({ ...metadata, token });
    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = openSync(this.path, "wx");
      writeSync(fileDescriptor, record, undefined, "utf8");
      closeSync(fileDescriptor);
      fileDescriptor = undefined;
      this.#token = token;
    } catch (error) {
      if (fileDescriptor !== undefined) closeSync(fileDescriptor);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        let existing: string | undefined;
        try {
          existing = readFileSync(this.path, "utf8");
        } catch {
          existing = undefined;
        }
        throw new WriterLockError(
          "another runtime already owns the database writer lock",
          { path: this.path, existing },
        );
      }
      throw new WriterLockError("could not acquire the database writer lock", {
        path: this.path,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  isHeld(): boolean {
    if (this.#token === undefined || !existsSync(this.path)) return false;
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as {
        token?: unknown;
      };
      return value.token === this.#token;
    } catch {
      return false;
    }
  }

  release(): void {
    const token = this.#token;
    if (token === undefined) return;
    this.#token = undefined;
    if (!existsSync(this.path)) return;
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as {
        token?: unknown;
      };
      if (value.token !== token) {
        throw new WriterLockError(
          "writer lock changed ownership before release; lock was preserved",
          { path: this.path },
        );
      }
      unlinkSync(this.path);
    } catch (error) {
      if (error instanceof WriterLockError) throw error;
      throw new WriterLockError("could not release the database writer lock", {
        path: this.path,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
