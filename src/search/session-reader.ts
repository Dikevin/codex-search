import { access, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { isBoilerplatePreviewText } from "./match-preview.js";
import {
  readSessionMetaFromFile,
  type SearchFileEntry,
  type TimeRange,
} from "./session-file-search.js";
import { createSearchExecutor, resolveConcurrency, searchStreamedHits } from "./search-executor.js";
import {
  matchesSearchView,
  type SearchFileProgressState,
  type SearchProgress,
  type SearchViewMode,
} from "./view-filter.js";

export type SearchSource = "active" | "archived";

export interface SearchArchivedSessionsOptions {
  query: string;
  codexHomeDir?: string;
  cwd?: string;
  sources?: SearchSource[];
  view?: SearchViewMode;
  caseSensitive?: boolean;
  page?: number;
  pageSize?: number;
  offset?: number;
  withTotal?: boolean;
  recent?: string;
  start?: string;
  end?: string;
  allTime?: boolean;
  now?: Date;
  signal?: AbortSignal;
  threadTitles?: Map<string, string>;
  concurrency?: number;
  onSessionSummary?: (summary: SearchSessionSummary) => void;
  onFileSearch?: (event: { filePath: string; mode: "stream"; engine: "worker" | "local" }) => void;
  onProgress?: (progress: SearchProgress) => void;
  onWarning?: (warning: SearchWarning) => void;
}

export interface SearchSessionSummary {
  sessionId: string;
  messageCount: number;
}

export type SearchWarning =
  | { type: "file_read_failed"; filePath: string; code: string | null; message: string }
  | { type: "thread_title_unavailable"; dbPath: string; code: string | null; message: string };

export interface SearchHit {
  sessionId: string;
  timestamp: string;
  cwd: string | null;
  title: string | null;
  snippet: string;
  preview: SearchMatchPreview;
  source: SearchSource;
  filePath: string;
  resumeCommand: string;
  deepLink: string;
}

export interface SearchMatchPreview {
  kind: "user" | "assistant" | "developer" | "system" | "reasoning" | "command" | "tool" | "file" | "output" | "meta" | "text";
  label: string;
  text: string;
  timestamp: string | null;
  secondaryText: string | null;
}

export interface SearchSessionGroup {
  sessionId: string;
  timestamp: string;
  cwd: string | null;
  filePath?: string | null;
  title: string | null;
  source: SearchSource;
  messageCount: number | null;
  previewSnippet: string;
  snippets: string[];
  matchPreviews: SearchMatchPreview[];
  matchCount: number;
  resumeCommand: string;
  deepLink: string;
}

export interface SearchResultsPage {
  hits: SearchHit[];
  page: number;
  pageSize: number;
  offset: number;
  hasMore: boolean;
  total?: number;
}

const DEFAULT_CODEX_HOME_DIR = join(homedir(), ".codex");
const DEFAULT_RECENT_DURATION = "30d";
const execFileAsync = promisify(execFile);

export async function searchArchivedSessions(
  options: SearchArchivedSessionsOptions,
): Promise<SearchResultsPage> {
  const pageSize = options.pageSize ?? 5;
  const page = options.page ?? 1;
  const offset = options.offset ?? ((page - 1) * pageSize);
  const results: SearchHit[] = [];

  for await (const hit of streamSearchHits(options)) {
    results.push(hit);
  }

  const sortedResults = results
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const end = offset + pageSize;

  return {
    hits: sortedResults.slice(offset, end),
    page,
    pageSize,
    offset,
    hasMore: end < sortedResults.length,
    total: options.withTotal ? sortedResults.length : undefined,
  };
}

export async function listRecordedCwds(
  options: Pick<
    SearchArchivedSessionsOptions,
    "codexHomeDir" | "sources" | "recent" | "start" | "end" | "allTime" | "now" | "signal"
  >,
): Promise<string[]> {
  const codexHomeDir = options.codexHomeDir ?? DEFAULT_CODEX_HOME_DIR;
  const sources = options.sources ?? ["active", "archived"];
  const timeRange = resolveTimeRange(options);
  const files: SearchFileEntry[] = [];

  for (const source of sources) {
    if (options.signal?.aborted) {
      return [];
    }

    const rootDir = getSourceRootDir(codexHomeDir, source);
    const sourceFiles = (await listJsonlFiles(rootDir, options.signal))
      .filter((entry) => fileMightMatchTimeRange(entry, timeRange));
    files.push(...sourceFiles);
  }

  const cwdValues: string[] = [];

  for (const file of files) {
    if (options.signal?.aborted) {
      return [];
    }

    const meta = await readSessionMetaFromFile(file.filePath, options.signal);
    if (meta?.cwd) {
      cwdValues.push(meta.cwd);
    }
  }

  return [...new Set(
    cwdValues,
  )].sort((left, right) => left.localeCompare(right));
}

export async function* streamSearchHits(
  options: SearchArchivedSessionsOptions,
): AsyncGenerator<SearchHit> {
  const codexHomeDir = options.codexHomeDir ?? DEFAULT_CODEX_HOME_DIR;
  const sources = options.sources ?? ["active"];
  const view = options.view ?? "useful";
  const caseSensitive = options.caseSensitive ?? false;
  const timeRange = resolveTimeRange(options);
  const threadTitles = options.threadTitles ?? await readThreadTitles(codexHomeDir, options.onWarning);
  const concurrency = resolveConcurrency(options.concurrency);
  const plans: Array<{
    source: SearchSource;
    files: SearchFileEntry[];
  }> = [];

  for (const source of sources) {
    if (options.signal?.aborted) {
      return;
    }

    const rootDir = getSourceRootDir(codexHomeDir, source);
    const files = (await listJsonlFiles(rootDir, options.signal))
      .filter((entry) => fileMightMatchTimeRange(entry, timeRange));
    plans.push({ source, files });
  }

  const allFiles = plans.flatMap((plan) => plan.files);
  const fileStates = new Map<string, SearchFileProgressState>();
  const emitProgress = () => {
    const scannedFiles = [...fileStates.values()].filter((state) => state === "done").length;
    const activeFiles = [...fileStates.values()].filter((state) => state === "scanning").length;
    options.onProgress?.({
      totalFiles: allFiles.length,
      readyFiles: scannedFiles,
      scannedFiles,
      activeFiles,
      fileStates: Object.fromEntries(fileStates),
    });
  };
  emitProgress();

  if (allFiles.length === 0) {
    return;
  }

  const executor = createSearchExecutor(concurrency, allFiles.length);
  const recordSearchResult = (result: {
    file: SearchFileEntry;
    hits: SearchHit[];
    completed: boolean;
  }) => {
    if (result.completed) {
      fileStates.set(result.file.filePath, "done");
    } else if (!fileStates.has(result.file.filePath)) {
      fileStates.set(result.file.filePath, "scanning");
    }

    if (result.completed) {
      emitProgress();
    }
  };
  const handleFileSearch = (event: { filePath: string; mode: "stream"; engine: "worker" | "local" }) => {
    fileStates.set(event.filePath, "scanning");
    options.onFileSearch?.(event);
    emitProgress();
  };

  try {
    let aborted = false;
    for (const plan of plans) {
    for await (const result of searchStreamedHits(plan.files, {
        caseSensitive,
        source: plan.source,
        timeRange,
        signal: options.signal,
        query: options.query,
        cwd: options.cwd ?? null,
        concurrency,
        onFileSearch: handleFileSearch,
        onResult: recordSearchResult,
        onWarning: (warning) => options.onWarning?.(warning),
        executor,
      })) {
      const hits = withThreadTitlesForHits(result.hits, threadTitles);

      if (result.completed && result.sessionSummary) {
        options.onSessionSummary?.(result.sessionSummary);
      }

      for (const hit of hits) {
        if (matchesSearchView(hit, view)) {
          yield hit;
          }
          if (options.signal?.aborted) {
            aborted = true;
            break;
          }
        }

        if (aborted || options.signal?.aborted) {
          break;
        }
      }

      if (aborted || options.signal?.aborted) {
        break;
      }
    }
  } finally {
    await executor.destroy();
  }
}

export function aggregateSearchHitsBySession(hits: SearchHit[]): SearchSessionGroup[] {
  return aggregateSearchHitsBySessionWithSummaries(hits);
}

export function aggregateSearchHitsBySessionWithSummaries(
  hits: SearchHit[],
  sessionSummaries?: ReadonlyMap<string, SearchSessionSummary>,
): SearchSessionGroup[] {
  const groups = new Map<string, SearchSessionGroup>();

  for (const hit of hits) {
    const preview = hit.preview ?? {
      kind: "text" as const,
      label: "Text",
      text: hit.snippet,
      timestamp: hit.timestamp,
      secondaryText: null,
    };
    const existing = groups.get(hit.sessionId);
    if (!existing) {
      groups.set(hit.sessionId, {
        sessionId: hit.sessionId,
        timestamp: hit.timestamp,
        cwd: hit.cwd,
        filePath: hit.filePath,
        title: hit.title,
        source: hit.source,
        messageCount: sessionSummaries?.get(hit.sessionId)?.messageCount ?? null,
        previewSnippet: preview.text,
        snippets: [hit.snippet],
        matchPreviews: [preview],
        matchCount: 1,
        resumeCommand: hit.resumeCommand,
        deepLink: hit.deepLink,
      });
      continue;
    }

    existing.messageCount = sessionSummaries?.get(hit.sessionId)?.messageCount ?? existing.messageCount;
    existing.filePath ??= hit.filePath;
    existing.matchCount += 1;
    if (!existing.snippets.includes(hit.snippet)) {
      existing.snippets.push(hit.snippet);
    }

    if (!existing.matchPreviews.some((item) => isSamePreview(item, preview))) {
      existing.matchPreviews.push(preview);
    }
  }

  return [...groups.values()]
    .map((group) => {
      const bestPreview = [...group.matchPreviews].sort((left, right) => comparePreviewPriority(left, right))[0];
      group.matchPreviews.sort((left, right) => comparePreviewDisplayOrder(left, right));
      group.previewSnippet = bestPreview?.text ?? group.previewSnippet;
      return group;
    })
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function withThreadTitlesForHits(
  hits: SearchHit[],
  threadTitles: Map<string, string>,
): SearchHit[] {
  if (!hits || hits.length === 0) {
    return [];
  }

  return hits.map((hit) => ({
    ...hit,
    title: threadTitles.get(hit.sessionId) ?? null,
  }));
}

async function listJsonlFiles(
  rootDir: string,
  signal: AbortSignal | undefined,
) : Promise<SearchFileEntry[]> {
  const results: SearchFileEntry[] = [];

  for await (const fileEntry of streamJsonlFiles(rootDir, signal)) {
    results.push(fileEntry);
  }

  return results.sort((left, right) => right.filePath.localeCompare(left.filePath));
}

async function* streamJsonlFiles(
  rootDir: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<SearchFileEntry> {
  if (signal?.aborted) {
    return;
  }

  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }

  for (const entry of entries.sort((left, right) => right.name.localeCompare(left.name))) {
    if (signal?.aborted) {
      return;
    }

    const nextPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      yield* streamJsonlFiles(nextPath, signal);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const stats = await stat(nextPath);
      yield {
        filePath: nextPath,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      };
    }
  }
}

type TimeRangeOptions = Pick<SearchArchivedSessionsOptions, "recent" | "start" | "end" | "allTime" | "now">;

function getSourceRootDir(codexHomeDir: string, source: SearchSource): string {
  return source === "active"
    ? join(codexHomeDir, "sessions")
    : join(codexHomeDir, "archived_sessions");
}

function resolveTimeRange(options: TimeRangeOptions): TimeRange | null {
  if (options.allTime) {
    return null;
  }

  if (options.recent) {
    const durationMs = parseRecentDuration(options.recent);
    const nowMs = (options.now ?? new Date()).getTime();
    return {
      startMs: nowMs - durationMs,
      endMs: nowMs,
    };
  }

  if (!options.start && !options.end) {
    const durationMs = parseRecentDuration(DEFAULT_RECENT_DURATION);
    const nowMs = (options.now ?? new Date()).getTime();
    return {
      startMs: nowMs - durationMs,
      endMs: nowMs,
    };
  }

  return {
    startMs: options.start ? parseDateBoundary(options.start, "start") : null,
    endMs: options.end ? parseDateBoundary(options.end, "end") : null,
  };
}

function fileMightMatchTimeRange(file: SearchFileEntry, timeRange: TimeRange | null): boolean {
  if (!timeRange) {
    return true;
  }

  if (timeRange.startMs !== null && file.mtimeMs >= timeRange.startMs && (
    timeRange.endMs === null || file.mtimeMs <= timeRange.endMs
  )) {
    return true;
  }

  const dateMs = parseFileDateMs(file.filePath);
  if (dateMs === null) {
    return true;
  }

  const dayStart = dateMs;
  const dayEnd = dateMs + 86_400_000 - 1;

  if (timeRange.startMs !== null && dayEnd < timeRange.startMs) {
    return false;
  }

  if (timeRange.endMs !== null && dayStart > timeRange.endMs) {
    return false;
  }

  return true;
}

function parseFileDateMs(filePath: string): number | null {
  const rolloutMatch = /rollout-(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T/.exec(filePath);
  const pathMatch = /\/(?<year>\d{4})\/(?<month>\d{2})\/(?<day>\d{2})\//.exec(filePath);
  const groups = rolloutMatch?.groups ?? pathMatch?.groups;
  if (!groups) {
    return null;
  }

  const year = Number.parseInt(groups.year ?? "", 10);
  const monthIndex = Number.parseInt(groups.month ?? "", 10) - 1;
  const day = Number.parseInt(groups.day ?? "", 10);
  const value = new Date(year, monthIndex, day, 0, 0, 0, 0).getTime();

  return Number.isFinite(value) ? value : null;
}

async function readThreadTitles(
  codexHomeDir: string,
  onWarning?: (warning: SearchWarning) => void,
): Promise<Map<string, string>> {
  const dbPath = join(codexHomeDir, "state_5.sqlite");

  try {
    await access(dbPath);
    const { stdout } = await execFileAsync("sqlite3", [
      "-json",
      dbPath,
      "select id, title from threads where title <> '';",
    ]);
    const rows = JSON.parse(stdout) as Array<{ id?: string; title?: string }>;

    return new Map(rows
      .filter((row): row is { id: string; title: string } => Boolean(row.id && row.title))
      .map((row) => [row.id, row.title]));
  } catch (error) {
    onWarning?.({
      type: "thread_title_unavailable",
      dbPath,
      code: typeof (error as NodeJS.ErrnoException | null)?.code === "string"
        ? (error as NodeJS.ErrnoException).code ?? null
        : null,
      message: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
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

function comparePreviewPriority(left: SearchMatchPreview, right: SearchMatchPreview): number {
  const scoreDiff = previewScore(left) - previewScore(right);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const leftTimestamp = left.timestamp ?? "";
  const rightTimestamp = right.timestamp ?? "";
  const timestampDiff = rightTimestamp.localeCompare(leftTimestamp);
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  return left.text.length - right.text.length;
}

function comparePreviewDisplayOrder(left: SearchMatchPreview, right: SearchMatchPreview): number {
  const leftTimestamp = left.timestamp ?? "";
  const rightTimestamp = right.timestamp ?? "";
  const timestampDiff = rightTimestamp.localeCompare(leftTimestamp);
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  return comparePreviewPriority(left, right);
}

function previewPriority(kind: SearchMatchPreview["kind"]): number {
  if (kind === "user") {
    return 0;
  }

  if (kind === "assistant") {
    return 1;
  }

  if (kind === "command" || kind === "tool" || kind === "output") {
    return 2;
  }

  if (kind === "reasoning" || kind === "file") {
    return 3;
  }

  if (kind === "text") {
    return 4;
  }

  if (kind === "meta") {
    return 5;
  }

  if (kind === "system") {
    return 6;
  }

  return 7;
}

function previewScore(preview: SearchMatchPreview): number {
  const normalized = preview.text.replace(/\s+/g, " ").trim();
  let score = previewPriority(preview.kind) * 10;

  if (isBoilerplatePreviewText(normalized)) {
    score += 15;
  }

  if (normalized.length > 140) {
    score += 3;
  } else if (normalized.length > 80) {
    score += 1;
  }

  if (normalized.length < 12) {
    score += 1;
  }

  return score;
}

function isSamePreview(left: SearchMatchPreview, right: SearchMatchPreview): boolean {
  return left.kind === right.kind
    && left.label === right.label
    && left.text === right.text
    && left.timestamp === right.timestamp
    && left.secondaryText === right.secondaryText;
}
