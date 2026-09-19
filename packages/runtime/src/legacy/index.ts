export {
  LegacyArchiveError,
  legacyRootLabels,
  writeLegacyArchive,
  type LegacyArchiveInput,
} from "./archive.js";
export {
  NodeLegacyFileSystem,
  type NodeLegacyFileSystemOptions,
} from "./fs.js";
export {
  buildLegacyImportEvents,
  legacySessionId,
  LEGACY_EVENT_VERSION,
  LEGACY_SOURCE_KIND,
  type LegacyEventBuildInput,
} from "./events.js";
export {
  asArray,
  asFiniteNumber,
  asInteger,
  asRecord,
  asString,
  canonicalizeDeclaredTimestamp,
  decodeUtf8,
  hasUtf8Bom,
  parseFrontmatter,
  parseJsonDocument,
  parseNdjson,
  sha256Hex,
  type FrontmatterFailure,
  type FrontmatterResult,
  type JsonParseResult,
  type NdjsonParseResult,
  type ParsedFrontmatter,
} from "./parse.js";
export {
  buildLegacyMigrationReport,
  serialiseLegacyMigrationReport,
  summariseLegacyAnomalies,
  type LegacyMigrationReportInput,
} from "./report.js";
export {
  buildLegacyMigrationPlan,
  classifyArtifact,
  scanLegacySources,
  withRoot,
  type LegacyFileSystem,
  type LegacyPlanInput,
  type LegacyScanOptions,
  type LegacyScanResult,
  type LegacySourceFile,
} from "./scanner.js";
