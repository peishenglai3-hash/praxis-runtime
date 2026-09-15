export { StoreError } from "./errors.js";
export type { StoreErrorCode } from "./errors.js";
export { restoreDatabaseFile, SqliteEventStore } from "./sqlite.js";
export type {
  BackupManifest,
  BackupOptions,
  ManagedBackup,
  PurgeCleanupResult,
  PrivacyPurgeOptions,
  PrivacyPurgePlan,
  PrivacyPurgeReceipt,
  PrivacyPurgeResult,
  ProjectionHealth,
  RestoreDatabaseOptions,
  SqliteEventStoreOptions,
  SqlitePragmas,
  StoreHealth,
} from "./sqlite.js";
