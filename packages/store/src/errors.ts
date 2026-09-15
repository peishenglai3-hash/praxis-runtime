export type StoreErrorCode =
  | "INVALID_EVENT"
  | "EVENT_ID_CONFLICT"
  | "OPERATION_ID_CONFLICT"
  | "AUTHORIZATION_ERROR"
  | "MIGRATION_ERROR"
  | "STORAGE_ERROR";

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: StoreErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.details = details;
  }
}
