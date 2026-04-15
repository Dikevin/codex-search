import type { SearchViewMode } from "../search/view-filter.js";
import {
  COMMAND_FLAGS,
  COMMAND_SPECS,
  FLAG_SPECS,
  GLOBAL_FLAGS,
  getUsage,
} from "./spec.js";

export interface ParsedArgs {
  mode: "search" | "lucky" | "completion" | "history";
  sourceMode: "all" | "active" | "archived";
  sourceModeExplicit: boolean;
  query: string | null;
  completionShell: "zsh" | "bash" | null;
  completionAction: "shell" | "durations" | "cwds" | null;
  historyAction: "list" | "clear" | "enable" | "disable";
  json: boolean;
  jsonl: boolean;
  view: SearchViewMode;
  caseSensitive: boolean;
  page: number;
  pageSize: number;
  offset: number | null;
  withTotal: boolean;
  paginationExplicit: boolean;
  rootDir: string | null;
  cwd: string | null;
  recent: string | null;
  start: string | null;
  end: string | null;
  allTime: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let mode: "search" | "lucky" | "completion" | "history" = "search";
  let sourceMode: "all" | "active" | "archived" = "active";
  let sourceModeExplicit = false;
  let query: string | null = null;
  let completionShell: "zsh" | "bash" | null = null;
  let completionAction: "shell" | "durations" | "cwds" | null = null;
  let historyAction: ParsedArgs["historyAction"] = "list";
  let historyActionSet = false;
  let json = false;
  let jsonl = false;
  let view: SearchViewMode = "useful";
  let caseSensitive = false;
  let page = 1;
  let pageSize = 5;
  let offset: number | null = null;
  let withTotal = false;
  let paginationExplicit = false;
  let pageSizeSource: "--limit" | "--page-size" | null = null;
  let rootDir: string | null = null;
  let cwd: string | null = null;
  let recent: string | null = null;
  let start: string | null = null;
  let end: string | null = null;
  let allTime = false;
  let help = false;
  let version = false;
  let positionalOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--" && !positionalOnly) {
      positionalOnly = true;
      continue;
    }

    if (positionalOnly) {
      if (query !== null || mode === "completion" || mode === "history") {
        throw new Error(`Usage: ${getUsage(
          mode === "lucky"
            ? "lucky"
            : mode === "completion"
              ? "completion"
              : mode === "history"
                ? "history"
                : "search",
        )}`);
      }

      query = arg;
      continue;
    }

    if (arg === "lucky" && query === null && index === 0) {
      mode = "lucky";
      continue;
    }

    if (arg === "completion" && query === null && index === 0) {
      mode = "completion";
      continue;
    }

    if (arg === "history" && query === null && index === 0) {
      mode = "history";
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--jsonl") {
      if (mode === "history") {
        throw new Error('History mode does not support "--jsonl".');
      }
      jsonl = true;
      continue;
    }

    if (arg === "--durations") {
      if (mode !== "completion") {
        throw new Error(`Unknown option "${arg}".`);
      }

      if (completionAction !== null) {
        throw new Error(`Usage: ${getUsage("completion", "durations")}`);
      }

      completionAction = "durations";
      continue;
    }

    if (arg === "--cwds") {
      if (mode !== "completion") {
        throw new Error(`Unknown option "${arg}".`);
      }

      if (completionAction !== null) {
        throw new Error(`Usage: ${getUsage("completion", "cwds")}`);
      }

      completionAction = "cwds";
      continue;
    }

    if (arg === "-i" || arg === "--case-sensitive") {
      caseSensitive = true;
      continue;
    }

    if (arg === "--view") {
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      if (!isSearchViewMode(value)) {
        throw new Error('"--view" must be one of: useful, ops, protocol, all.');
      }

      view = value;
      index += 1;
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
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
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
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
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
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
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
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
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

    if (arg === "-D" || arg === "--cwd") {
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      cwd = value;
      index += 1;
      continue;
    }

    if (arg === "--active") {
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
      sourceMode = parseSourceMode(sourceMode, sourceModeExplicit, "active");
      sourceModeExplicit = true;
      continue;
    }

    if (arg === "--archived") {
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
      sourceMode = parseSourceMode(sourceMode, sourceModeExplicit, "archived");
      sourceModeExplicit = true;
      continue;
    }

    if (arg === "--all") {
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
      sourceMode = parseSourceMode(sourceMode, sourceModeExplicit, "all");
      sourceModeExplicit = true;
      continue;
    }

    if (arg === "--recent") {
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      if (allTime || start !== null || end !== null) {
        throw new Error('"--recent" cannot be combined with "--all-time", "--start", or "--end".');
      }

      recent = value;
      index += 1;
      continue;
    }

    if (arg === "--start") {
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      if (allTime || recent !== null) {
        throw new Error('"--start" cannot be combined with "--all-time" or "--recent".');
      }

      start = value;
      index += 1;
      continue;
    }

    if (arg === "--end") {
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Usage: ${getUsage()}`);
      }

      if (allTime || recent !== null) {
        throw new Error('"--end" cannot be combined with "--all-time" or "--recent".');
      }

      end = value;
      index += 1;
      continue;
    }

    if (arg === "--all-time") {
      if (mode === "history") {
        throw new Error(`Unknown option "${arg}".`);
      }
      if (recent !== null || start !== null || end !== null) {
        throw new Error('"--all-time" cannot be combined with "--recent", "--start", or "--end".');
      }

      allTime = true;
      continue;
    }

    if (mode === "history" && !arg.startsWith("-")) {
      if (historyActionSet) {
        throw new Error(`Usage: ${getUsage("history")}`);
      }

      if (!isHistoryAction(arg)) {
        throw new Error(`Usage: ${getUsage("history")}`);
      }

      historyAction = arg;
      historyActionSet = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(formatUnknownFlagError(arg, mode));
    }

    if (mode === "completion") {
      if (completionAction === "durations") {
        throw new Error(`Usage: ${getUsage("completion", "durations")}`);
      }

      if (completionAction === "cwds") {
        throw new Error(`Usage: ${getUsage("completion", "cwds")}`);
      }

      if (completionShell !== null || (arg !== "zsh" && arg !== "bash")) {
        throw new Error(`Usage: ${getUsage("completion")}`);
      }

      completionShell = arg;
      completionAction = "shell";
      continue;
    }

    if (mode === "history") {
      throw new Error(`Usage: ${getUsage("history")}`);
    }

    if (query !== null) {
      const commandSuggestion = suggestCommand(query);
      if (commandSuggestion) {
        throw new Error(formatUnknownCommandError(query, commandSuggestion));
      }

      throw new Error(`Usage: ${getUsage()}`);
    }

    query = arg;
  }

  if (offset !== null && page !== 1) {
    throw new Error('"--page" and "--offset" cannot be combined.');
  }

  return {
    mode,
    sourceMode,
    sourceModeExplicit,
    query,
    completionShell,
    completionAction,
    historyAction,
    json,
    jsonl,
    view,
    caseSensitive,
    page,
    pageSize,
    offset,
    withTotal,
    paginationExplicit,
    rootDir,
    cwd,
    recent,
    start,
    end,
    allTime,
    help,
    version,
  };
}

function isHistoryAction(value: string): value is ParsedArgs["historyAction"] {
  return value === "list" || value === "clear" || value === "enable" || value === "disable";
}

function isSearchViewMode(value: string): value is SearchViewMode {
  return value === "useful" || value === "ops" || value === "protocol" || value === "all";
}

function parseSourceMode(
  current: ParsedArgs["sourceMode"],
  explicit: boolean,
  next: ParsedArgs["sourceMode"],
): ParsedArgs["sourceMode"] {
  if (explicit && current !== next) {
    throw new Error('Choose only one of "--active", "--archived", or "--all".');
  }

  return next;
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

function formatUnknownFlagError(
  flag: string,
  mode: ParsedArgs["mode"],
): string {
  const suggestion = suggestFlag(flag, mode);
  if (!suggestion) {
    return `Error: Unknown flag "${flag}".`;
  }

  return `Error: Unknown flag "${flag}".\nDid you mean "${suggestion}"?`;
}

function formatUnknownCommandError(
  command: string,
  suggestion: string,
): string {
  return `Error: Unknown command "${command}".\nDid you mean "${suggestion}"?`;
}

function suggestCommand(command: string): string | null {
  return findClosestMatch(
    command,
    COMMAND_SPECS
      .map((candidate) => candidate.name)
      .filter((candidate) => candidate !== "search"),
  );
}

function suggestFlag(
  input: string,
  mode: ParsedArgs["mode"],
): string | null {
  const allowedFlags = new Set<string>(GLOBAL_FLAGS);
  for (const flag of COMMAND_FLAGS[mode] ?? []) {
    allowedFlags.add(flag);
  }

  const candidateToCanonical = new Map<string, string>();
  for (const flagSpec of FLAG_SPECS) {
    if (!allowedFlags.has(flagSpec.flag)) {
      continue;
    }

    candidateToCanonical.set(flagSpec.flag, flagSpec.flag);
    for (const alias of flagSpec.aliases ?? []) {
      candidateToCanonical.set(alias, flagSpec.flag);
    }
  }

  const suggestion = findClosestMatch(input, [...candidateToCanonical.keys()]);
  return suggestion ? candidateToCanonical.get(suggestion) ?? null : null;
}

function findClosestMatch(
  input: string,
  candidates: readonly string[],
): string | null {
  let bestCandidate: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = damerauLevenshteinDistance(input, candidate);
    if (distance > allowedSuggestionDistance(input, candidate)) {
      continue;
    }

    if (
      distance < bestDistance ||
      (distance === bestDistance &&
        bestCandidate !== null &&
        candidate.length < bestCandidate.length)
    ) {
      bestCandidate = candidate;
      bestDistance = distance;
    }
  }

  return bestCandidate;
}

function allowedSuggestionDistance(
  input: string,
  candidate: string,
): number {
  const longestLength = Math.max(input.length, candidate.length);
  return longestLength >= 8 ? 2 : 1;
}

function damerauLevenshteinDistance(
  left: string,
  right: string,
): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row]![0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0]![col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const substitutionCost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + substitutionCost,
      );

      if (
        row > 1 &&
        col > 1 &&
        left[row - 1] === right[col - 2] &&
        left[row - 2] === right[col - 1]
      ) {
        matrix[row]![col] = Math.min(
          matrix[row]![col]!,
          matrix[row - 2]![col - 2]! + 1,
        );
      }
    }
  }

  return matrix[left.length]![right.length]!;
}
