export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface RuntimeConfig {
  schemaVersion: "1";
  dataDir: string;
}

export interface ConfigLoader<TConfig extends RuntimeConfig = RuntimeConfig> {
  load(): TConfig;
}
