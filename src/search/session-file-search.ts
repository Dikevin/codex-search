import { createReadStream } from "node:fs";
import { normalize, resolve, sep } from "node:path";
import readline from "node:readline";

import { buildMatchPreview } from "./match-preview.ts";
import type { SearchHit, SearchSessionSummary, SearchSource } from "./session-reader.ts";

const MAX_SNIPPET_LENGTH = 160;
const STREAM_CHUNK_MATCHES = 8;

export interface SearchFileEntry {
  filePath: string;
  mtimeMs: number;
  size: number;
}

export interface TimeRange {
  startMs: number | null;
  endMs: number | null;
}

export interface SearchFileTaskOptions {
  query: string;
  cwd: string | null;
  caseSensitive: boolean;
  source: SearchSource;
  timeRange: TimeRange | null;
  mode: "stream";
  signal?: AbortSignal;
}

export interface SearchWorkerChunkMessage {
  type: "chunk" | "done";
  hits?: SearchHit[];
}

export interface SearchFileTaskResult {
  hits: SearchHit[];
  sessionSummary: SearchSessionSummary | null;
}

interface SessionMeta {
  sessionId: string;
  timestamp: string;
  cwd: string | null;
}

export async function readSessionMetaFromFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<SessionMeta | null> {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });
  const abort = () => {
    input.destroy();
    lines.close();
  };

  signal?.addEventListener("abort", abort, { once: true });

  try {
    for await (const line of lines) {
      if (signal?.aborted) {
        return null;
      }

      return tryReadSessionMetaFromParsed(tryParseJson(line));
    }

    return null;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function searchSessionFileHits(
  fileEntry: SearchFileEntry,
  options: SearchFileTaskOptions,
): Promise<SearchFileTaskResult> {
  return searchSessionFileHitsWithReporter(fileEntry, options);
}

export async function searchSessionFileHitsWithReporter(
  fileEntry: SearchFileEntry,
  options: SearchFileTaskOptions,
  reportChunk?: (hits: SearchHit[]) => void,
): Promise<SearchFileTaskResult> {
  const results: SearchHit[] = [];
  const { filePath } = fileEntry;
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });
  const abort = () => {
    input.destroy();
    lines.close();
  };

  let sessionMeta: SessionMeta | null = null;
  let messageCount = 0;
  const normalizedQuery = options.caseSensitive ? options.query : options.query.toLowerCase();
  let emittedFirstHit = false;
  let bufferedHits: SearchHit[] = [];

  const flushChunk = () => {
    if (bufferedHits.length === 0) {
      return;
    }

    reportChunk?.(bufferedHits);
    bufferedHits = [];
  };

  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    for await (const line of lines) {
      if (options.signal?.aborted) {
        return {
          hits: reportChunk ? [] : results,
          sessionSummary: sessionMeta
            ? {
              sessionId: sessionMeta.sessionId,
              messageCount,
            }
            : null,
        };
      }

      const parsed = tryParseJson(line);

      if (!sessionMeta) {
        sessionMeta = tryReadSessionMetaFromParsed(parsed);
      }

      if (isConversationMessage(parsed)) {
        messageCount += 1;
      }

      if (sessionMeta && options.cwd && !matchesCwdFilter(sessionMeta.cwd, options.cwd)) {
        return {
          hits: reportChunk ? [] : results,
          sessionSummary: sessionMeta
            ? {
              sessionId: sessionMeta.sessionId,
              messageCount,
            }
            : null,
        };
      }

      const hitTimestamp = extractTimestampFromParsed(parsed) ?? sessionMeta?.timestamp ?? null;
      if (hitTimestamp && !matchesTimeRange(hitTimestamp, options.timeRange)) {
        continue;
      }

      const lineForMatch = options.caseSensitive ? line : line.toLowerCase();
      if (!lineForMatch.includes(normalizedQuery)) {
        continue;
      }

      const snippet = extractSnippet(line, parsed, options.query, options.caseSensitive);
      if (!snippet || !sessionMeta) {
        continue;
      }

      const hit = {
        sessionId: sessionMeta.sessionId,
        timestamp: hitTimestamp ?? sessionMeta.timestamp,
        cwd: sessionMeta.cwd,
        title: null,
        snippet,
        preview: buildMatchPreview(line, snippet),
        source: options.source,
        filePath,
        resumeCommand: `codex resume ${sessionMeta.sessionId}`,
        deepLink: `codex://threads/${sessionMeta.sessionId}`,
      } satisfies SearchHit;

      if (!reportChunk) {
        results.push(hit);
        continue;
      }

      results.push(hit);
      if (!emittedFirstHit) {
        reportChunk([hit]);
        emittedFirstHit = true;
        continue;
      }

      bufferedHits.push(hit);
      if (bufferedHits.length >= STREAM_CHUNK_MATCHES) {
        flushChunk();
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }

  flushChunk();
  return {
    hits: reportChunk ? [] : results,
    sessionSummary: sessionMeta
      ? {
        sessionId: sessionMeta.sessionId,
        messageCount,
      }
      : null,
  };
}

function tryReadSessionMetaFromParsed(value: unknown): SessionMeta | null {
  try {
    const parsed = value as {
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

function extractTimestampFromParsed(value: unknown): string | null {
  const parsed = value as { timestamp?: unknown } | null;
  return typeof parsed?.timestamp === "string" ? parsed.timestamp : null;
}

function isConversationMessage(value: unknown): boolean {
  const parsed = value as {
    type?: unknown;
    payload?: {
      type?: unknown;
      role?: unknown;
    };
  } | null;

  return parsed?.type === "response_item"
    && parsed.payload?.type === "message"
    && (parsed.payload?.role === "user" || parsed.payload?.role === "assistant");
}

function extractSnippet(
  line: string,
  parsed: unknown,
  query: string,
  caseSensitive: boolean,
): string | null {
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

function matchesCwdFilter(sessionCwd: string | null, cwdFilter: string): boolean {
  if (!sessionCwd) {
    return false;
  }

  const candidate = normalize(resolve(sessionCwd));
  const target = normalize(resolve(cwdFilter));
  return candidate === target || candidate.startsWith(`${target}${sep}`);
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
