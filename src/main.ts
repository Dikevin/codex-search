import packageJson from "../package.json" with { type: "json" };
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { parseArgs, type ParsedArgs } from "./cli/args.js";
import { buildCompletionBashScript, buildCompletionZshScript, listCompletionDurations, printHelp } from "./cli/help.js";
import { formatJsonResults, formatJsonlEvent, formatJsonlProgress } from "./cli/output.js";
import { appendSearchLog, type SearchLogMode, type SearchLogRecord, type SearchLogResults, type SearchLogStatus } from "./cli/search-log.js";
import { getUsage } from "./cli/spec.js";
import { listRecordedCwds, type SearchArchivedSessionsOptions, type SearchHit, type SearchResultsPage, type SearchSource, searchArchivedSessions, streamSearchHits } from "./search/session-reader.js";
import { runSearchTui } from "./tui/index.js";
import type { SearchProgress } from "./search/view-filter.js";

interface CliStreams {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

interface RunCliOptions extends Partial<CliStreams> {
  openUrl?: (url: string) => Promise<void>;
  resumeSession?: (sessionId: string) => Promise<number>;
  runTui?: (options: {
    query: string;
    caseSensitive?: boolean;
    results?: SearchResultsPage;
    hitStream?: AsyncIterable<SearchHit>;
    cancelSearch?: () => void;
    sourceLabel?: string;
    rangeLabel?: string;
    cwdLabel?: string;
    searchState?: {
      progress?: SearchProgress | null;
      sessionSummaries?: Map<string, { sessionId: string; messageCount: number }>;
    };
    stdin: NodeJS.ReadStream;
    stdout: NodeJS.WriteStream;
    openHit: (hit: SearchHit) => Promise<void>;
    resumeHit: (hit: SearchHit) => Promise<number>;
  }) => Promise<number>;
  isInteractiveTty?: boolean;
  now?: Date;
  writeSearchLog?: (codexHomeDir: string | null | undefined, record: SearchLogRecord) => Promise<void>;
}

const execFileAsync = promisify(execFile);
const WSL_ENV_KEYS = ["WSL_DISTRO_NAME", "WSL_INTEROP"] as const;

interface SearchRunStats {
  hits: number;
  threadIds: Set<string>;
  progress: SearchProgress | null;
  completed: boolean;
}

interface SearchLogContext {
  mode: SearchLogMode;
  startedAtMs: number;
  startedAt: string;
  query: string;
  flags: SearchLogRecord["flags"];
}

export async function runCli(
  argv: string[],
  options: RunCliOptions = {},
): Promise<number> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const openUrl = options.openUrl ?? defaultOpenUrl;
  const resumeSession = options.resumeSession ?? defaultResumeSession;
  const runTui = options.runTui ?? runSearchTui;
  const isInteractiveTty = options.isInteractiveTty ?? Boolean(stdin.isTTY && stdout.isTTY);
  const writeSearchLog = options.writeSearchLog ?? appendSearchLog;
  const now = options.now;

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  if (parsed.version) {
    stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  if (parsed.help) {
    printHelp(stdout);
    return 0;
  }

  if (parsed.mode === "completion") {
    if (parsed.completionAction === "durations") {
      stdout.write(`${listCompletionDurations().join("\n")}\n`);
      return 0;
    }

    if (parsed.completionAction === "cwds") {
      const completionSources = parsed.sourceModeExplicit
        ? (parsed.sourceMode === "all" ? ["active", "archived"] : [parsed.sourceMode]) as SearchSource[]
        : ["active", "archived"] as SearchSource[];
      const cwdValues = await listRecordedCwds({
        codexHomeDir: parsed.rootDir ?? undefined,
        sources: completionSources,
        recent: parsed.recent ?? undefined,
        start: parsed.start ?? undefined,
        end: parsed.end ?? undefined,
        allTime: parsed.allTime,
        now,
      });
      if (cwdValues.length > 0) {
        stdout.write(`${cwdValues.join("\n")}\n`);
      }
      return 0;
    }

    if (parsed.completionAction !== "shell" || !parsed.completionShell) {
      stderr.write(`Usage: ${getUsage("completion")}\n`);
      return 1;
    }

    stdout.write(parsed.completionShell === "zsh" ? buildCompletionZshScript() : buildCompletionBashScript());
    return 0;
  }

  if (!parsed.query) {
    printHelp(stderr);
    return 1;
  }

  if (parsed.mode === "lucky" && (parsed.paginationExplicit || parsed.json || parsed.jsonl)) {
    stderr.write('Lucky mode does not support "--json", "--jsonl", "--page", "--page-size", "--offset", "--limit", or "--with-total".\n');
    return 1;
  }

  if (parsed.json && parsed.jsonl) {
    stderr.write('Choose either "--json" or "--jsonl", not both.\n');
    return 1;
  }

  if (parsed.jsonl && parsed.paginationExplicit) {
    stderr.write('JSONL mode does not support "--page", "--page-size", "--offset", "--limit", or "--with-total". Use "--json" for paged output.\n');
    return 1;
  }

  if (!parsed.json && !parsed.jsonl && parsed.paginationExplicit) {
    stderr.write('Interactive mode does not support "--page", "--page-size", "--offset", "--limit", or "--with-total". Use "--json" for standard output.\n');
    return 1;
  }

  if (parsed.mode !== "lucky" && !parsed.json && !parsed.jsonl && !isInteractiveTty) {
    stderr.write("Interactive output requires a TTY. Use --json or --jsonl for standard output.\n");
    return 1;
  }

  const searchOptions = {
    query: parsed.query,
    codexHomeDir: parsed.rootDir ?? undefined,
    cwd: parsed.cwd ? resolve(parsed.cwd) : undefined,
    sources: (parsed.sourceMode === "all" ? ["active", "archived"] : [parsed.sourceMode]) as SearchSource[],
    view: parsed.view,
    caseSensitive: parsed.caseSensitive,
    recent: parsed.recent ?? undefined,
    start: parsed.start ?? undefined,
    end: parsed.end ?? undefined,
    allTime: parsed.allTime,
    now,
  };

  if (parsed.mode === "lucky") {
    const logContext = createSearchLogContext("lucky", parsed, searchOptions);
    try {
      const luckyHit = await findLuckyOpenableHit(searchOptions, parsed.sourceMode);
      if (!luckyHit) {
        const archivedHit = await findLuckyArchivedHit(searchOptions, parsed.sourceMode);
        if (archivedHit) {
          stderr.write(`${archivedUnavailableMessage(archivedHit)}\n`);
        } else {
          stderr.write("No matches found.\n");
        }
        await finishSearchLog(writeSearchLog, parsed.rootDir, logContext, "completed", 1, {
          hits: 0,
          threads: 0,
        }, null);
        return 1;
      }

      await openUrl(luckyHit.deepLink);
      stdout.write(`Opened ${luckyHit.deepLink}\n`);
      await finishSearchLog(writeSearchLog, parsed.rootDir, logContext, "completed", 0, {
        hits: 1,
        threads: 1,
      }, null);
      return 0;
    } catch (error) {
      await finishSearchLog(writeSearchLog, parsed.rootDir, logContext, "failed", 1, {
        hits: 0,
        threads: 0,
      }, null, error);
      throw error;
    }
  }

  if (parsed.json) {
    const logContext = createSearchLogContext("json", parsed, searchOptions);
    try {
      const results = await searchArchivedSessions({
        ...searchOptions,
        page: parsed.page,
        pageSize: parsed.pageSize,
        offset: parsed.offset ?? undefined,
        withTotal: parsed.withTotal,
      });
      stdout.write(formatJsonResults(results));
      await finishSearchLog(writeSearchLog, parsed.rootDir, logContext, "completed", 0, resultsToLogResults(results), null);
      return 0;
    } catch (error) {
      await finishSearchLog(writeSearchLog, parsed.rootDir, logContext, "failed", 1, {
        hits: 0,
        threads: 0,
      }, null, error);
      throw error;
    }
  }

  if (parsed.jsonl) {
    const logContext = createSearchLogContext("jsonl", parsed, searchOptions);
    const searchAbortController = new AbortController();
    let latestProgress: SearchProgress | null = null;
    let hitCount = 0;
    const threadIds = new Set<string>();

    try {
      for await (const hit of streamSearchHits({
        ...searchOptions,
        signal: searchAbortController.signal,
        onProgress: (progress) => {
          latestProgress = progress;
          stdout.write(formatJsonlEvent({
            type: "progress",
            progress: formatJsonlProgress(progress),
          }));
        },
      })) {
        hitCount += 1;
        threadIds.add(hit.sessionId);
        stdout.write(formatJsonlEvent({
          type: "hit",
          hit,
        }));
      }

      stdout.write(formatJsonlEvent({
        type: "summary",
        hits: hitCount,
        threads: threadIds.size,
        view: parsed.view,
        progress: latestProgress ? formatJsonlProgress(latestProgress) : null,
      }));
      await finishSearchLog(writeSearchLog, parsed.rootDir, logContext, "completed", 0, {
        hits: hitCount,
        threads: threadIds.size,
      }, latestProgress);
      return 0;
    } catch (error) {
      await finishSearchLog(writeSearchLog, parsed.rootDir, logContext, "failed", 1, {
        hits: hitCount,
        threads: threadIds.size,
      }, latestProgress, error);
      throw error;
    }
  }

  const searchAbortController = new AbortController();
  const logContext = createSearchLogContext("tui", parsed, searchOptions);
  const searchStats = createSearchRunStats();
  const searchState = {
    progress: null as SearchProgress | null,
    sessionSummaries: new Map<string, { sessionId: string; messageCount: number }>(),
    notify: undefined as (() => void) | undefined,
  };
  try {
    const exitCode = await runTui({
      query: parsed.query,
      caseSensitive: parsed.caseSensitive,
      hitStream: trackSearchHits(streamSearchHits({
        ...searchOptions,
        signal: searchAbortController.signal,
        onProgress: (progress) => {
          searchState.progress = progress;
          searchStats.progress = progress;
          searchState.notify?.();
        },
        onSessionSummary: (summary) => {
          searchState.sessionSummaries.set(summary.sessionId, summary);
          searchState.notify?.();
        },
      }), searchStats),
      cancelSearch: () => searchAbortController.abort(),
      sourceLabel: formatSourceLabel(parsed.sourceMode),
      rangeLabel: formatRangeLabel(parsed),
      cwdLabel: parsed.cwd ?? undefined,
      searchState,
      stdin,
      stdout,
      openHit: async (hit) => {
        await openUrl(hit.deepLink);
      },
      resumeHit: async (hit) => resumeSession(hit.sessionId),
    });
    const status = searchStats.completed ? "completed" : "cancelled";
    await finishSearchLog(writeSearchLog, parsed.rootDir, logContext, status, exitCode, {
      hits: searchStats.hits,
      threads: searchStats.threadIds.size,
    }, searchStats.progress);
    return exitCode;
  } catch (error) {
    await finishSearchLog(writeSearchLog, parsed.rootDir, logContext, "failed", 1, {
      hits: searchStats.hits,
      threads: searchStats.threadIds.size,
    }, searchStats.progress, error);
    throw error;
  }
}

function createSearchRunStats(): SearchRunStats {
  return {
    hits: 0,
    threadIds: new Set<string>(),
    progress: null,
    completed: false,
  };
}

async function* trackSearchHits(
  hitStream: AsyncIterable<SearchHit>,
  stats: SearchRunStats,
): AsyncGenerator<SearchHit> {
  for await (const hit of hitStream) {
    stats.hits += 1;
    stats.threadIds.add(hit.sessionId);
    yield hit;
  }

  stats.completed = true;
}

function createSearchLogContext(
  mode: SearchLogMode,
  parsed: ParsedArgs,
  searchOptions: SearchArchivedSessionsOptions,
): SearchLogContext {
  const startedAtMs = Date.now();

  return {
    mode,
    startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    query: parsed.query ?? "",
    flags: {
      sourceMode: parsed.sourceMode,
      sources: searchOptions.sources ?? ["active"],
      view: parsed.view,
      caseSensitive: parsed.caseSensitive,
      cwd: searchOptions.cwd ?? null,
      recent: parsed.recent ?? null,
      start: parsed.start ?? null,
      end: parsed.end ?? null,
      allTime: parsed.allTime,
      json: parsed.json,
      jsonl: parsed.jsonl,
      page: parsed.json ? parsed.page : null,
      pageSize: parsed.json ? parsed.pageSize : null,
      offset: parsed.json ? parsed.offset : null,
      withTotal: parsed.withTotal,
    },
  };
}

async function finishSearchLog(
  writeSearchLog: (codexHomeDir: string | null | undefined, record: SearchLogRecord) => Promise<void>,
  codexHomeDir: string | null,
  context: SearchLogContext,
  status: SearchLogStatus,
  exitCode: number,
  results: SearchLogResults,
  progress: SearchProgress | null,
  error?: unknown,
): Promise<void> {
  const endedAtMs = Date.now();
  const record: SearchLogRecord = {
    version: 1,
    type: "search",
    startedAt: context.startedAt,
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: Math.max(0, endedAtMs - context.startedAtMs),
    mode: context.mode,
    status,
    exitCode,
    query: context.query,
    flags: context.flags,
    results,
    progress: progress ? formatJsonlProgress(progress) : null,
    ...(error ? { error: formatErrorForLog(error) } : {}),
  };

  try {
    await writeSearchLog(codexHomeDir, record);
  } catch {
    // Logging is best-effort and should not change CLI exit behavior.
  }
}

function resultsToLogResults(results: SearchResultsPage): SearchLogResults {
  return {
    hits: results.hits.length,
    threads: countThreads(results.hits),
    page: results.page,
    pageSize: results.pageSize,
    offset: results.offset,
    hasMore: results.hasMore,
    ...(results.total !== undefined ? { total: results.total } : {}),
  };
}

function countThreads(hits: SearchHit[]): number {
  return new Set(hits.map((hit) => hit.sessionId)).size;
}

function formatErrorForLog(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function findLuckyOpenableHit(
  searchOptions: Omit<SearchArchivedSessionsOptions, "page" | "pageSize">,
  sourceMode: ParsedArgs["sourceMode"],
): Promise<SearchHit | null> {
  if (sourceMode === "archived") {
    return null;
  }

  const results = await searchArchivedSessions({
    ...searchOptions,
    sources: ["active"],
    page: 1,
    pageSize: 1,
  });

  return results.hits[0] ?? null;
}

async function findLuckyArchivedHit(
  searchOptions: Omit<SearchArchivedSessionsOptions, "page" | "pageSize">,
  sourceMode: ParsedArgs["sourceMode"],
): Promise<SearchHit | null> {
  if (sourceMode === "active") {
    return null;
  }

  const results = await searchArchivedSessions({
    ...searchOptions,
    sources: ["archived"],
    page: 1,
    pageSize: 1,
  });

  return results.hits[0] ?? null;
}

function archivedUnavailableMessage(hit: SearchHit): string {
  return `Archived thread cannot be reopened directly: ${hit.sessionId}. Use --active to search reopenable threads.`;
}

function formatSourceLabel(sourceMode: ParsedArgs["sourceMode"]): string {
  return sourceMode;
}

function formatRangeLabel(parsed: ParsedArgs): string {
  if (parsed.allTime) {
    return "all time";
  }

  if (parsed.recent) {
    return `recent ${parsed.recent}`;
  }

  if (parsed.start || parsed.end) {
    return `${parsed.start ?? "begin"}..${parsed.end ?? "today"}`;
  }

  return "recent 30d";
}

async function defaultOpenUrl(url: string): Promise<void> {
  let lastError: unknown = null;

  for (const candidate of getOpenUrlCandidates()) {
    const [command, ...args] = candidate;
    try {
      if (!command) {
        continue;
      }

      await execFileAsync(command, [...args, url]);
      return;
    } catch (error) {
      const execError = error as NodeJS.ErrnoException;
      if (execError.code === "ENOENT") {
        lastError = error;
        continue;
      }

      throw error;
    }
  }

  throw lastError ?? new Error("No supported opener command found.");
}

async function defaultResumeSession(sessionId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["resume", sessionId], {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
  });
}

export function getOpenUrlCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[][] {
  if (platform === "darwin") {
    return [["open"]];
  }

  if (platform === "linux") {
    return isWslEnv(env)
      ? [["wslview"], ["xdg-open"]]
      : [["xdg-open"]];
  }

  return [["open"]];
}

function isWslEnv(env: NodeJS.ProcessEnv): boolean {
  return WSL_ENV_KEYS.some((key) => Boolean(env[key]));
}
