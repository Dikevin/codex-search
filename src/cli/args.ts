import { getUsage } from "./spec.js";

export interface ParsedArgs {
  mode: "search" | "lucky";
  query: string | null;
  json: boolean;
  caseSensitive: boolean;
  page: number;
  pageSize: number;
  offset: number | null;
  withTotal: boolean;
  paginationExplicit: boolean;
  rootDir: string | null;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let mode: "search" | "lucky" = "search";
  let query: string | null = null;
  let json = false;
  let caseSensitive = false;
  let page = 1;
  let pageSize = 5;
  let offset: number | null = null;
  let withTotal = false;
  let paginationExplicit = false;
  let pageSizeSource: "--limit" | "--page-size" | null = null;
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

    if (arg === "-n" || arg === "--limit" || arg === "--page-size") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      const parsedPageSize = parsePositiveInteger(value, arg);
      const nextSource = arg === "--page-size" ? "--page-size" : "--limit";
      if (pageSizeSource && pageSizeSource !== nextSource) {
        throw new Error('"--limit" and "--page-size" cannot be combined.');
      }

      pageSize = parsedPageSize;
      pageSizeSource = nextSource;
      paginationExplicit = true;
      index += 1;
      continue;
    }

    if (arg === "-p" || arg === "--page") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      page = parsePositiveInteger(value, arg);
      paginationExplicit = true;
      index += 1;
      continue;
    }

    if (arg === "-o" || arg === "--offset") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      if (offset !== null) {
        throw new Error('Provide "--offset" only once.');
      }

      offset = parseNonNegativeInteger(value, arg);
      paginationExplicit = true;
      index += 1;
      continue;
    }

    if (arg === "--with-total") {
      withTotal = true;
      paginationExplicit = true;
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

  if (offset !== null && page !== 1) {
    throw new Error('"--page" and "--offset" cannot be combined.');
  }

  return {
    mode,
    query,
    json,
    caseSensitive,
    page,
    pageSize,
    offset,
    withTotal,
    paginationExplicit,
    rootDir,
    help,
    version,
  };
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value "${value}" for "${option}".`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string, option: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value "${value}" for "${option}".`);
  }

  return parsed;
}
