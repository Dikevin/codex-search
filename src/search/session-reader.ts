import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

export interface SearchArchivedSessionsOptions {
  query: string;
  rootDir?: string;
  caseSensitive?: boolean;
  limit?: number;
}

export interface SearchHit {
  sessionId: string;
  timestamp: string;
  cwd: string | null;
  snippet: string;
  filePath: string;
  resumeCommand: string;
  deepLink: string;
}

interface SessionMeta {
  sessionId: string;
  timestamp: string;
  cwd: string | null;
}

const DEFAULT_ROOT_DIR = join(homedir(), ".codex", "archived_sessions");
const MAX_SNIPPET_LENGTH = 160;

export async function searchArchivedSessions(
  options: SearchArchivedSessionsOptions,
): Promise<SearchHit[]> {
  const rootDir = options.rootDir ?? DEFAULT_ROOT_DIR;
  const caseSensitive = options.caseSensitive ?? false;
  const limit = options.limit ?? 20;
  const files = await listJsonlFiles(rootDir);
  const results: SearchHit[] = [];

  for (const filePath of files) {
    if (results.length >= limit) {
      break;
    }

    const fileResults = await searchFile(filePath, options.query, {
      caseSensitive,
      remaining: limit - results.length,
    });
    results.push(...fileResults);
  }

  return results;
}

async function listJsonlFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(rootDir, entry.name))
    .sort();
}

async function searchFile(
  filePath: string,
  query: string,
  options: { caseSensitive: boolean; remaining: number },
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
