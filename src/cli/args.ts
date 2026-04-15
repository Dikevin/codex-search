import { getUsage } from "./spec.js";

export interface ParsedArgs {
  mode: "search" | "lucky";
  sourceMode: "all" | "active" | "archived";
  query: string | null;
  json: boolean;
  caseSensitive: boolean;
  limit: number;
  rootDir: string | null;
  recent: string | null;
  start: string | null;
  end: string | null;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let mode: "search" | "lucky" = "search";
  let sourceMode: "all" | "active" | "archived" = "all";
  let query: string | null = null;
  let json = false;
  let caseSensitive = false;
  let limit = 20;
  let rootDir: string | null = null;
  let recent: string | null = null;
  let start: string | null = null;
  let end: string | null = null;
  let help = false;
  let version = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "lucky" && query === null && index === 0) {
      mode = "lucky";
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "-i" || arg === "--case-sensitive") {
      caseSensitive = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      version = true;
      continue;
    }

    if (arg === "-n" || arg === "--limit") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      const parsedLimit = Number.parseInt(value, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        throw new Error(`Invalid limit "${value}".`);
      }

      limit = parsedLimit;
      index += 1;
      continue;
    }

    if (arg === "--root-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      rootDir = value;
      index += 1;
      continue;
    }

    if (arg === "--active") {
      if (sourceMode === "archived") {
        throw new Error('Choose only one of "--active" or "--archived".');
      }

      sourceMode = "active";
      continue;
    }

    if (arg === "--archived") {
      if (sourceMode === "active") {
        throw new Error('Choose only one of "--active" or "--archived".');
      }

      sourceMode = "archived";
      continue;
    }

    if (arg === "--recent") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      if (start !== null || end !== null) {
        throw new Error('"--recent" cannot be combined with "--start" or "--end".');
      }

      recent = value;
      index += 1;
      continue;
    }

    if (arg === "--start") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      if (recent !== null) {
        throw new Error('"--start" cannot be combined with "--recent".');
      }

      start = value;
      index += 1;
      continue;
    }

    if (arg === "--end") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      if (recent !== null) {
        throw new Error('"--end" cannot be combined with "--recent".');
      }

      end = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}".`);
    }

    if (query !== null) {
      throw new Error(`Usage: ${getUsage()}`);
    }

    query = arg;
  }

  return {
    mode,
    sourceMode,
    query,
    json,
    caseSensitive,
    limit,
    rootDir,
    recent,
    start,
    end,
    help,
    version,
  };
}
