import { getUsage } from "./spec.js";

export interface ParsedArgs {
  mode: "search" | "lucky";
  query: string | null;
  json: boolean;
  caseSensitive: boolean;
  limit: number;
  rootDir: string | null;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let mode: "search" | "lucky" = "search";
  let query: string | null = null;
  let json = false;
  let caseSensitive = false;
  let limit = 20;
  let rootDir: string | null = null;
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
    query,
    json,
    caseSensitive,
    limit,
    rootDir,
    help,
    version,
  };
}
