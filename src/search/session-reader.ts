import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

export type SearchSource = "active" | "archived";

export interface SearchArchivedSessionsOptions {
  query: string;
  codexHomeDir?: string;
  sources?: SearchSource[];
  caseSensitive?: boolean;
  limit?: number;
  recent?: string;
  start?: string;
  end?: string;
  now?: Date;
}

export interface SearchHit {
  sessionId: string;
  timestamp: string;
  cwd: string | null;
  snippet: string;
  source: SearchSource;
  filePath: string;
  resumeCommand: string;
  deepLink: string;
}

interface SessionMeta {
  sessionId: string;
  timestamp: string;
  cwd: string | null;
}

interface TimeRange {
  startMs: number | null;
  endMs: number | null;
}

const DEFAULT_CODEX_HOME_DIR = join(homedir(), ".codex");
const MAX_SNIPPET_LENGTH = 160;

export async function searchArchivedSessions(
  options: SearchArchivedSessionsOptions,
): Promise<SearchHit[]> {
  const codexHomeDir = options.codexHomeDir ?? DEFAULT_CODEX_HOME_DIR;
  const sources = options.sources ?? ["active", "archived"];
  const caseSensitive = options.caseSensitive ?? false;
  const limit = options.limit ?? 20;
  const timeRange = resolveTimeRange(options);
  const results: SearchHit[] = [];

  for (const source of sources) {
    const rootDir = getSourceRootDir(codexHomeDir, source);
    const files = await listJsonlFiles(rootDir);

    for (const filePath of files) {
      const fileResults = await searchFile(filePath, options.query, {
        caseSensitive,
        remaining: limit,
        source,
        timeRange,
      });
      results.push(...fileResults);
    }
  }

  return results
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, limit);
}

async function listJsonlFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  await walkJsonlFiles(rootDir, results);
  return results.sort();
}

async function walkJsonlFiles(rootDir: string, output: string[]): Promise<void> {
  const entries = await readdir(rootDir, { withFileTypes: true });

  await Promise.all(entries.map(async (entry) => {
    const nextPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonlFiles(nextPath, output);
      return;
    }

    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      output.push(nextPath);
    }
  }));
}

async function searchFile(
  filePath: string,
  query: string,
  options: {
    caseSensitive: boolean;
    remaining: number;
    source: SearchSource;
    timeRange: TimeRange | null;
  },
): Promise<SearchHit[]> {
  const results: SearchHit[] = [];
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  let sessionMeta: SessionMeta | null = null;
  const normalizedQuery = options.caseSensitive ? query : query.toLowerCase();

  for await (const line of lines) {
    if (results.length >= options.remaining) {
      break;
    }

    if (!sessionMeta) {
      sessionMeta = tryReadSessionMeta(line);
    }

    if (sessionMeta && !matchesTimeRange(sessionMeta.timestamp, options.timeRange)) {
      continue;
    }

    const lineForMatch = options.caseSensitive ? line : line.toLowerCase();
    if (!lineForMatch.includes(normalizedQuery)) {
      continue;
    }

    const snippet = extractSnippet(line, query, options.caseSensitive);
    if (!snippet || !sessionMeta) {
      continue;
    }

    results.push({
      sessionId: sessionMeta.sessionId,
      timestamp: sessionMeta.timestamp,
      cwd: sessionMeta.cwd,
      snippet,
      source: options.source,
      filePath,
      resumeCommand: `codex resume ${sessionMeta.sessionId}`,
      deepLink: `codex://threads/${sessionMeta.sessionId}`,
    });
  }

  return results;
}

function tryReadSessionMeta(line: string): SessionMeta | null {
  try {
    const parsed = JSON.parse(line) as {
      type?: string;
      payload?: {
        id?: string;
        timestamp?: string;
        cwd?: string;
      };
    };

    if (parsed.type !== "session_meta" || !parsed.payload?.id || !parsed.payload.timestamp) {
      return null;
    }

    return {
      sessionId: parsed.payload.id,
      timestamp: parsed.payload.timestamp,
      cwd: parsed.payload.cwd ?? null,
    };
  } catch {
    return null;
  }
}

function extractSnippet(line: string, query: string, caseSensitive: boolean): string | null {
  const parsed = tryParseJson(line);
  const strings = parsed ? collectStrings(parsed) : [line];
  const normalizedQuery = caseSensitive ? query : query.toLowerCase();

  for (const candidate of strings) {
    const haystack = caseSensitive ? candidate : candidate.toLowerCase();
    const index = haystack.indexOf(normalizedQuery);
    if (index === -1) {
      continue;
    }

    return trimAroundMatch(candidate, index, query.length);
  }

  return null;
}

function tryParseJson(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectStrings(item));
  }

  return [];
}

function trimAroundMatch(text: string, startIndex: number, queryLength: number): string {
  const context = Math.max(0, Math.floor((MAX_SNIPPET_LENGTH - queryLength) / 2));
  const start = Math.max(0, startIndex - context);
  const end = Math.min(text.length, startIndex + queryLength + context);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function getSourceRootDir(codexHomeDir: string, source: SearchSource): string {
  return source === "active"
    ? join(codexHomeDir, "sessions")
    : join(codexHomeDir, "archived_sessions");
}

function resolveTimeRange(options: SearchArchivedSessionsOptions): TimeRange | null {
  if (options.recent) {
    const durationMs = parseRecentDuration(options.recent);
    const nowMs = (options.now ?? new Date()).getTime();
    return {
      startMs: nowMs - durationMs,
      endMs: nowMs,
    };
  }

  if (!options.start && !options.end) {
    return null;
  }

  return {
    startMs: options.start ? parseDateBoundary(options.start, "start") : null,
    endMs: options.end ? parseDateBoundary(options.end, "end") : null,
  };
}

function parseRecentDuration(value: string): number {
  const match = /^(?<amount>[1-9][0-9]*)(?<unit>m|h|d|w)$/.exec(value);
  if (!match?.groups) {
    throw new Error(`Invalid recent duration "${value}". Use forms like 30m, 12h, 7d, or 2w.`);
  }

  const groups = match.groups as Record<"amount" | "unit", string>;
  const amount = Number.parseInt(groups.amount, 10);
  const unit = groups.unit;
  const unitMs = unit === "m"
    ? 60_000
    : unit === "h"
      ? 3_600_000
      : unit === "d"
        ? 86_400_000
        : 604_800_000;

  return amount * unitMs;
}

function parseDateBoundary(value: string, edge: "start" | "end"): number {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(value);
  if (!match?.groups) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD.`);
  }

  const groups = match.groups as Record<"year" | "month" | "day", string>;
  const year = Number.parseInt(groups.year, 10);
  const monthIndex = Number.parseInt(groups.month, 10) - 1;
  const day = Number.parseInt(groups.day, 10);

  if (edge === "start") {
    return new Date(year, monthIndex, day, 0, 0, 0, 0).getTime();
  }

  return new Date(year, monthIndex, day, 23, 59, 59, 999).getTime();
}

function matchesTimeRange(timestamp: string, timeRange: TimeRange | null): boolean {
  if (!timeRange) {
    return true;
  }

  const tsMs = Date.parse(timestamp);
  if (!Number.isFinite(tsMs)) {
    return false;
  }

  if (timeRange.startMs !== null && tsMs < timeRange.startMs) {
    return false;
  }

  if (timeRange.endMs !== null && tsMs > timeRange.endMs) {
    return false;
  }

  return true;
}
