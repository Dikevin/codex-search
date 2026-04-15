import packageJson from "../package.json" with { type: "json" };
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { parseArgs, type ParsedArgs } from "./cli/args.js";
import { buildCompletionBashScript, buildCompletionZshScript, listCompletionDurations, printHelp } from "./cli/help.js";
import { readConfig, writeConfig, type CodexSearchConfig } from "./cli/config.js";
import { appendEventLog, type EventLogRecord } from "./cli/events-log.js";
import { clearSearchHistory, deleteSearchHistoryEntry, listSearchHistory } from "./cli/history.js";
import { formatJsonResults, formatJsonlEvent, formatJsonlProgress } from "./cli/output.js";
import {
  appendSearchLog,
  getSearchLogPath,
  type SearchLogMode,
  type SearchLogRecord,
  type SearchLogResults,
  type SearchLogStatus,
} from "./cli/search-log.js";
import { getUsage } from "./cli/spec.js";
import {
  aggregateSearchHitsBySessionWithSummaries,
  listRecordedCwds,
  type SearchArchivedSessionsOptions,
  type SearchHit,
  type SearchResultsPage,
  type SearchSource,
  type SearchWarning,
  searchArchivedSessions,
  streamSearchHits,
} from "./search/session-reader.js";
import { runSearchTui } from "./tui/index.js";
import {
  createDefaultTuiFilters,
  formatTuiRangeLabel,
  type TuiSearchFilters,
} from "./tui/search-filters.js";
import type { TuiQuerySuggestion } from "./tui/types.js";
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
    initialFilters?: TuiSearchFilters;
    historyEnabled?: boolean;
    onStartSearch?: (request: {
      query: string;
      filters: TuiSearchFilters;
      reason?: "submit" | "suggestion" | "filters";
    }) => Promise<{
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
    }>;
    onLuckySearch?: (request: { query: string; filters: TuiSearchFilters }) => Promise<{
      opened: boolean;
      message?: string;
    }>;
    onLoadSuggestions?: (request: {
      query: string;
      limit: number;
    }) => Promise<{
      recent: TuiQuerySuggestion[];
      projects: TuiQuerySuggestion[];
    }>;
    onPreviewSearch?: (request: {
      query: string;
      filters: TuiSearchFilters;
      signal: AbortSignal;
      limit: number;
    }) => Promise<ReturnType<typeof aggregateSearchHitsBySessionWithSummaries>>;
    onDeleteRecentQuery?: (query: string) => Promise<boolean>;
    stdin: NodeJS.ReadStream;
    stdout: NodeJS.WriteStream;
    openHit: (hit: SearchHit, origin?: "list" | "preview") => Promise<void>;
    resumeHit: (hit: SearchHit) => Promise<number>;
  }) => Promise<number>;
  isInteractiveTty?: boolean;
  now?: Date;
  writeSearchLog?: (codexHomeDir: string | null | undefined, record: SearchLogRecord) => Promise<void>;
  writeEventLog?: (codexHomeDir: string | null | undefined, record: EventLogRecord) => Promise<void>;
  readSearchConfig?: (codexHomeDir: string | null | undefined) => Promise<CodexSearchConfig>;
  writeSearchConfig?: (codexHomeDir: string | null | undefined, config: CodexSearchConfig) => Promise<void>;
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

async function handleHistoryCommand(options: {
  parsed: ParsedArgs;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
  config: CodexSearchConfig;
  writeEventLog: (codexHomeDir: string | null | undefined, record: EventLogRecord) => Promise<void>;
  writeSearchConfig: (codexHomeDir: string | null | undefined, config: CodexSearchConfig) => Promise<void>;
}): Promise<number> {
  const logPath = getSearchLogPath(options.parsed.rootDir);

  if (options.parsed.historyAction === "list") {
    if (!options.config.history.enabled) {
      if (options.parsed.json) {
        options.stdout.write(`${JSON.stringify({ enabled: false, entries: [] }, null, 2)}\n`);
      } else {
        options.stdout.write("Search history is disabled.\n");
      }
      return 0;
    }

    const entries = await listSearchHistory(logPath);
    if (options.parsed.json) {
      options.stdout.write(`${JSON.stringify({ enabled: true, entries }, null, 2)}\n`);
      return 0;
    }

    if (entries.length === 0) {
      options.stdout.write("No search history.\n");
      return 0;
    }

    options.stdout.write(formatHistoryTable(entries));
    return 0;
  }

  if (options.parsed.json) {
    options.stderr.write("History management commands do not support --json.\n");
    return 1;
  }

  if (options.parsed.historyAction === "clear") {
    await clearSearchHistory(logPath);
    await options.writeEventLog(options.parsed.rootDir, {
      version: 1,
      type: "event",
      time: new Date().toISOString(),
      severity: "info",
      event: "history_clear",
      mode: "history",
    });
    options.stdout.write("Cleared search history.\n");
    return 0;
  }

  const nextConfig: CodexSearchConfig = {
    ...options.config,
    history: {
      enabled: options.parsed.historyAction === "enable",
    },
  };
  await options.writeSearchConfig(options.parsed.rootDir, nextConfig);
  await options.writeEventLog(options.parsed.rootDir, {
    version: 1,
    type: "event",
    time: new Date().toISOString(),
    severity: "info",
    event: options.parsed.historyAction === "enable" ? "history_enabled" : "history_disabled",
    mode: "history",
  });
  options.stdout.write(
    options.parsed.historyAction === "enable"
      ? "Enabled search history.\n"
      : "Disabled search history.\n",
  );
  return 0;
}

function formatHistoryTable(
  entries: Awaited<ReturnType<typeof listSearchHistory>>,
): string {
  const queryWidth = Math.max(
    "Query".length,
    ...entries.map((entry) => entry.query.length),
  );
  const countWidth = Math.max(
    "Count".length,
    ...entries.map((entry) => String(entry.count).length),
  );
  const lines = [
    `${"Query".padEnd(queryWidth, " ")}  ${"Count".padStart(countWidth, " ")}  Last Used`,
    ...entries.map((entry) => (
      `${entry.query.padEnd(queryWidth, " ")}  ${String(entry.count).padStart(countWidth, " ")}  ${entry.lastUsedAt.slice(0, 16).replace("T", " ")}`
    )),
  ];

  return `${lines.join("\n")}\n`;
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
  const writeEventLog = options.writeEventLog ?? appendEventLog;
  const readSearchConfig = options.readSearchConfig ?? readConfig;
  const writeSearchConfig = options.writeSearchConfig ?? writeConfig;
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

  const config = await readSearchConfig(parsed.rootDir);
  const writeSearchHistory = async (
    codexHomeDir: string | null | undefined,
    record: SearchLogRecord,
  ) => {
    if (!config.history.enabled) {
      return;
    }

    await writeSearchLog(codexHomeDir, record);
  };

  if (parsed.mode === "history") {
    return handleHistoryCommand({
      parsed,
      stdout,
      stderr,
      config,
      writeEventLog,
      writeSearchConfig,
    });
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

  if (!parsed.query && (!isInteractiveTty || parsed.mode !== "search" || parsed.json || parsed.jsonl)) {
    printHelp(stderr);
    return 1;
  }

  if (parsed.mode !== "lucky" && !parsed.json && !parsed.jsonl && !isInteractiveTty) {
    stderr.write("Interactive output requires a TTY. Use --json or --jsonl for standard output.\n");
    return 1;
  }

  const searchOptions = {
    query: parsed.query ?? "",
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
    const warningReporter = createSearchWarningReporter(writeEventLog, parsed.rootDir, "lucky", parsed.query ?? "");
    try {
      const luckyHit = await findLuckyOpenableHit(searchOptions, parsed.sourceMode, warningReporter);
      if (!luckyHit) {
        const archivedHit = await findLuckyArchivedHit(searchOptions, parsed.sourceMode, warningReporter);
        if (archivedHit) {
          stderr.write(`${archivedUnavailableMessage(archivedHit)}\n`);
        } else {
          stderr.write("No matches found.\n");
        }
        await finishSearchLog(writeSearchHistory, writeEventLog, parsed.rootDir, logContext, "completed", 1, {
          hits: 0,
          threads: 0,
        }, null);
        return 1;
      }

      await openUrl(luckyHit.deepLink);
      stdout.write(`Opened ${luckyHit.deepLink}\n`);
      await finishSearchLog(writeSearchHistory, writeEventLog, parsed.rootDir, logContext, "completed", 0, {
        hits: 1,
        threads: 1,
      }, null);
      await writeEventLog(parsed.rootDir, {
        version: 1,
        type: "event",
        time: new Date().toISOString(),
        severity: "info",
        event: "lucky_open",
        mode: "lucky",
        query: parsed.query ?? "",
        details: {
          sessionId: luckyHit.sessionId,
          source: luckyHit.source,
          deepLink: luckyHit.deepLink,
        },
      });
      return 0;
    } catch (error) {
      await finishSearchLog(writeSearchHistory, writeEventLog, parsed.rootDir, logContext, "failed", 1, {
        hits: 0,
        threads: 0,
      }, null, error);
      throw error;
    }
  }

  if (parsed.json) {
    const logContext = createSearchLogContext("json", parsed, searchOptions);
    const warningReporter = createSearchWarningReporter(writeEventLog, parsed.rootDir, "json", parsed.query ?? "");
    try {
      const results = await searchArchivedSessions({
        ...searchOptions,
        page: parsed.page,
        pageSize: parsed.pageSize,
        offset: parsed.offset ?? undefined,
        withTotal: parsed.withTotal,
        onWarning: warningReporter,
      });
      stdout.write(formatJsonResults(results));
      await finishSearchLog(writeSearchHistory, writeEventLog, parsed.rootDir, logContext, "completed", 0, resultsToLogResults(results), null);
      return 0;
    } catch (error) {
      await finishSearchLog(writeSearchHistory, writeEventLog, parsed.rootDir, logContext, "failed", 1, {
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
    const warningReporter = createSearchWarningReporter(writeEventLog, parsed.rootDir, "jsonl", parsed.query ?? "");

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
        onWarning: warningReporter,
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
      await finishSearchLog(writeSearchHistory, writeEventLog, parsed.rootDir, logContext, "completed", 0, {
        hits: hitCount,
        threads: threadIds.size,
      }, latestProgress);
      return 0;
    } catch (error) {
      await finishSearchLog(writeSearchHistory, writeEventLog, parsed.rootDir, logContext, "failed", 1, {
        hits: hitCount,
        threads: threadIds.size,
      }, latestProgress, error);
      throw error;
    }
  }

  const projectHints = await buildProjectHints(parsed, now);
  const initialFilters = buildTuiFilters(parsed);
  const initialSession = parsed.query
    ? createInteractiveSearchSession({
      parsed,
      query: parsed.query,
      filters: initialFilters,
      now,
      recordHistory: true,
      writeSearchLog: writeSearchHistory,
      writeEventLog,
    })
    : {
      query: "",
      caseSensitive: initialFilters.caseSensitive,
      results: {
        hits: [],
        page: 1,
        pageSize: 5,
        offset: 0,
        hasMore: false,
      },
      sourceLabel: formatSourceLabel(initialFilters.sourceMode),
      rangeLabel: formatTuiRangeLabel(initialFilters),
      cwdLabel: parsed.cwd ?? undefined,
    };
  const tuiSessionId = randomUUID();
  const tuiStartedAt = Date.now();
  await writeEventLog(parsed.rootDir, {
    version: 1,
    type: "event",
    time: new Date(tuiStartedAt).toISOString(),
    severity: "info",
    event: "session_start",
    sessionId: tuiSessionId,
    mode: "tui-session",
    details: {
      query: parsed.query ?? "",
      width: stdout.columns ?? null,
      height: stdout.rows ?? null,
      sourceMode: initialFilters.sourceMode,
      view: initialFilters.view,
      caseSensitive: initialFilters.caseSensitive,
      range: formatTuiRangeLabel(initialFilters),
    },
  });

  const exitCode = await runTui({
    ...initialSession,
    initialFilters,
    onStartSearch: async ({ query, filters, reason }) => createInteractiveSearchSession({
      parsed,
      query,
      filters,
      now,
      recordHistory: reason !== "filters",
      writeSearchLog: writeSearchHistory,
      writeEventLog,
    }),
    onLuckySearch: async ({ query, filters }) => runInteractiveLuckySearch({
      parsed,
      query,
      filters,
      now,
      openUrl,
      writeSearchLog: writeSearchHistory,
      writeEventLog,
    }),
    historyEnabled: config.history.enabled,
    onLoadSuggestions: async ({ query, limit }) => ({
      recent: config.history.enabled
        ? filterRecentSuggestions(await listSearchHistory(getSearchLogPath(parsed.rootDir)), query, limit)
        : [],
      projects: filterProjectSuggestions(projectHints, query, limit),
    }),
    onPreviewSearch: async ({ query, filters, signal, limit }) => runInteractivePreviewSearch({
      parsed,
      query,
      filters,
      now,
      limit,
      signal,
      writeEventLog,
    }),
    onDeleteRecentQuery: async (query) => {
      const deleted = await deleteSearchHistoryEntry(getSearchLogPath(parsed.rootDir), query);
      if (deleted) {
        await writeEventLog(parsed.rootDir, {
          version: 1,
          type: "event",
          time: new Date().toISOString(),
          severity: "info",
          event: "history_delete",
          mode: "history",
          query,
        });
      }
      return deleted;
    },
    stdin,
    stdout,
    openHit: async (hit, origin = "list") => {
      try {
        await openUrl(hit.deepLink);
        await writeEventLog(parsed.rootDir, {
          version: 1,
          type: "event",
          time: new Date().toISOString(),
          severity: "info",
          event: origin === "preview" ? "preview_open" : "desktop_open",
          sessionId: tuiSessionId,
          mode: "tui",
          query: parsed.query ?? "",
          details: {
            sessionId: hit.sessionId,
            source: hit.source,
            deepLink: hit.deepLink,
          },
        });
      } catch (error) {
        await writeEventLog(parsed.rootDir, {
          version: 1,
          type: "event",
          time: new Date().toISOString(),
          severity: "error",
          event: "desktop_open_failed",
          sessionId: tuiSessionId,
          mode: "tui",
          query: parsed.query ?? "",
          details: {
            sessionId: hit.sessionId,
            source: hit.source,
            deepLink: hit.deepLink,
            error: formatErrorForLog(error),
          },
        });
        throw error;
      }
    },
    resumeHit: async (hit) => {
      try {
        const resumeExitCode = await resumeSession(hit.sessionId);
        await writeEventLog(parsed.rootDir, {
          version: 1,
          type: "event",
          time: new Date().toISOString(),
          severity: resumeExitCode === 0 ? "info" : "error",
          event: resumeExitCode === 0 ? "resume" : "resume_failed",
          sessionId: tuiSessionId,
          mode: "tui",
          query: parsed.query ?? "",
          details: {
            targetSessionId: hit.sessionId,
            exitCode: resumeExitCode,
          },
        });
        return resumeExitCode;
      } catch (error) {
        await writeEventLog(parsed.rootDir, {
          version: 1,
          type: "event",
          time: new Date().toISOString(),
          severity: "error",
          event: "resume_failed",
          sessionId: tuiSessionId,
          mode: "tui",
          query: parsed.query ?? "",
          details: {
            targetSessionId: hit.sessionId,
            error: formatErrorForLog(error),
          },
        });
        throw error;
      }
    },
  });
  await writeEventLog(parsed.rootDir, {
    version: 1,
    type: "event",
    time: new Date().toISOString(),
    severity: "info",
    event: "session_end",
    sessionId: tuiSessionId,
    mode: "tui-session",
    details: {
      exitCode,
      durationMs: Math.max(0, Date.now() - tuiStartedAt),
    },
  });
  return exitCode;
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

function buildTuiFilters(parsed: ParsedArgs): TuiSearchFilters {
  const filters = createDefaultTuiFilters();
  filters.sourceMode = parsed.sourceMode;
  filters.view = parsed.view;
  filters.caseSensitive = parsed.caseSensitive;
  filters.timeFilter = parsed.allTime
    ? { kind: "all-time" }
    : parsed.start || parsed.end
      ? { kind: "range", start: parsed.start ?? null, end: parsed.end ?? null }
      : { kind: "recent", value: parsed.recent ?? "30d" };
  return filters;
}

function buildSearchOptionsFromTuiFilters(
  parsed: ParsedArgs,
  query: string,
  filters: TuiSearchFilters,
  now: Date | undefined,
): SearchArchivedSessionsOptions {
  return {
    query,
    codexHomeDir: parsed.rootDir ?? undefined,
    cwd: parsed.cwd ? resolve(parsed.cwd) : undefined,
    sources: (filters.sourceMode === "all" ? ["active", "archived"] : [filters.sourceMode]) as SearchSource[],
    view: filters.view,
    caseSensitive: filters.caseSensitive,
    recent: filters.timeFilter.kind === "recent" ? filters.timeFilter.value : undefined,
    start: filters.timeFilter.kind === "range" ? filters.timeFilter.start ?? undefined : undefined,
    end: filters.timeFilter.kind === "range" ? filters.timeFilter.end ?? undefined : undefined,
    allTime: filters.timeFilter.kind === "all-time",
    now,
  };
}

function createSearchLogContextForTui(
  mode: SearchLogMode,
  parsed: ParsedArgs,
  query: string,
  filters: TuiSearchFilters,
  searchOptions: SearchArchivedSessionsOptions,
): SearchLogContext {
  const startedAtMs = Date.now();

  return {
    mode,
    startedAtMs,
    startedAt: new Date(startedAtMs).toISOString(),
    query,
    flags: {
      sourceMode: filters.sourceMode,
      sources: searchOptions.sources ?? ["active"],
      view: filters.view,
      caseSensitive: filters.caseSensitive,
      cwd: searchOptions.cwd ?? null,
      recent: filters.timeFilter.kind === "recent" ? filters.timeFilter.value : null,
      start: filters.timeFilter.kind === "range" ? filters.timeFilter.start : null,
      end: filters.timeFilter.kind === "range" ? filters.timeFilter.end : null,
      allTime: filters.timeFilter.kind === "all-time",
      json: false,
      jsonl: false,
      page: null,
      pageSize: null,
      offset: null,
      withTotal: false,
    },
  };
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
  writeEventLog: ((codexHomeDir: string | null | undefined, record: EventLogRecord) => Promise<void>) | null,
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

  if (!writeEventLog) {
    return;
  }

  await writeEventLog(codexHomeDir, {
    version: 1,
    type: "event",
    time: record.endedAt,
    severity: status === "failed" ? "error" : "info",
    event: "search_run",
    mode: context.mode,
    query: context.query,
    details: {
      status,
      exitCode,
      results,
      progress: record.progress,
      flags: context.flags,
      ...(record.error ? { error: record.error } : {}),
    },
  });
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

async function buildProjectHints(
  parsed: ParsedArgs,
  now: Date | undefined,
): Promise<TuiQuerySuggestion[]> {
  const cwdValues = await listRecordedCwds({
    codexHomeDir: parsed.rootDir ?? undefined,
    sources: ["active", "archived"],
    allTime: true,
    now,
  });

  const counts = new Map<string, number>();
  for (const cwdValue of cwdValues) {
    const segments = cwdValue.split("/").filter(Boolean);
    const projectName = segments.at(-1);
    if (!projectName) {
      continue;
    }

    counts.set(projectName, (counts.get(projectName) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({
      kind: "project" as const,
      value,
      count,
    }))
    .sort((left, right) => right.count! - left.count! || left.value.localeCompare(right.value));
}

function filterRecentSuggestions(
  entries: Awaited<ReturnType<typeof listSearchHistory>>,
  query: string,
  limit: number,
): TuiQuerySuggestion[] {
  return entries
    .filter((entry) => query.trim() === "" || entry.normalizedQuery.includes(query.trim().toLowerCase()))
    .slice(0, limit)
    .map((entry) => ({
      kind: "recent" as const,
      value: entry.query,
      count: entry.count,
    }));
}

function filterProjectSuggestions(
  entries: TuiQuerySuggestion[],
  query: string,
  limit: number,
): TuiQuerySuggestion[] {
  const needle = query.trim().toLowerCase();
  return entries
    .filter((entry) => needle === "" || entry.value.toLowerCase().includes(needle))
    .slice(0, limit);
}

function createSearchWarningReporter(
  writeEventLog: (codexHomeDir: string | null | undefined, record: EventLogRecord) => Promise<void>,
  codexHomeDir: string | null,
  mode: EventLogRecord["mode"],
  query: string,
): (warning: SearchWarning) => void {
  const seen = new Set<string>();

  return (warning) => {
    const key = warning.type === "file_read_failed"
      ? `${warning.type}:${warning.filePath}:${warning.code ?? ""}`
      : `${warning.type}:${warning.dbPath}:${warning.code ?? ""}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    void writeEventLog(codexHomeDir, {
      version: 1,
      type: "event",
      time: new Date().toISOString(),
      severity: "warn",
      event: warning.type,
      mode,
      query,
      details: warning.type === "file_read_failed"
        ? {
          filePath: warning.filePath,
          code: warning.code,
          message: warning.message,
        }
        : {
          dbPath: warning.dbPath,
          code: warning.code,
          message: warning.message,
        },
    });
  };
}

async function runInteractivePreviewSearch(options: {
  parsed: ParsedArgs;
  query: string;
  filters: TuiSearchFilters;
  now: Date | undefined;
  limit: number;
  signal: AbortSignal;
  writeEventLog: (codexHomeDir: string | null | undefined, record: EventLogRecord) => Promise<void>;
}) {
  const searchOptions = buildSearchOptionsFromTuiFilters(
    options.parsed,
    options.query,
    options.filters,
    options.now,
  );
  const hits: SearchHit[] = [];
  const sessionSummaries = new Map<string, { sessionId: string; messageCount: number }>();
  const seenSessions = new Set<string>();
  const previewAbortController = new AbortController();
  const forwardAbort = () => previewAbortController.abort();

  if (options.signal.aborted) {
    return [];
  }

  options.signal.addEventListener("abort", forwardAbort, { once: true });
  const warningReporter = createSearchWarningReporter(
    options.writeEventLog,
    options.parsed.rootDir,
    "preview",
    options.query,
  );

  try {
    for await (const hit of streamSearchHits({
      ...searchOptions,
      signal: previewAbortController.signal,
      concurrency: 2,
      onSessionSummary: (summary) => {
        sessionSummaries.set(summary.sessionId, summary);
      },
      onWarning: warningReporter,
    })) {
      hits.push(hit);
      seenSessions.add(hit.sessionId);
      if (seenSessions.size >= options.limit) {
        previewAbortController.abort();
      }
    }
  } catch (error) {
    if (!previewAbortController.signal.aborted) {
      throw error;
    }
  } finally {
    options.signal.removeEventListener("abort", forwardAbort);
  }

  return aggregateSearchHitsBySessionWithSummaries(hits, sessionSummaries).slice(0, options.limit);
}

function countThreads(hits: SearchHit[]): number {
  return new Set(hits.map((hit) => hit.sessionId)).size;
}

function formatErrorForLog(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createInteractiveSearchSession(options: {
  parsed: ParsedArgs;
  query: string;
  filters: TuiSearchFilters;
  now: Date | undefined;
  recordHistory?: boolean;
  writeSearchLog: (codexHomeDir: string | null | undefined, record: SearchLogRecord) => Promise<void>;
  writeEventLog: (codexHomeDir: string | null | undefined, record: EventLogRecord) => Promise<void>;
}): {
  query: string;
  caseSensitive: boolean;
  hitStream: AsyncIterable<SearchHit>;
  cancelSearch: () => void;
  sourceLabel: string;
  rangeLabel: string;
  cwdLabel?: string;
  searchState: {
    progress: SearchProgress | null;
    sessionSummaries: Map<string, { sessionId: string; messageCount: number }>;
    notify?: () => void;
  };
} {
  const searchOptions = buildSearchOptionsFromTuiFilters(
    options.parsed,
    options.query,
    options.filters,
    options.now,
  );
  const logContext = createSearchLogContextForTui(
    "tui",
    options.parsed,
    options.query,
    options.filters,
    searchOptions,
  );
  const searchAbortController = new AbortController();
  const searchStats = createSearchRunStats();
  const searchState = {
    progress: null as SearchProgress | null,
    sessionSummaries: new Map<string, { sessionId: string; messageCount: number }>(),
    notify: undefined as (() => void) | undefined,
  };
  const warningReporter = createSearchWarningReporter(
    options.writeEventLog,
    options.parsed.rootDir,
    "tui",
    options.query,
  );
  const trackedStream = trackSearchHits(streamSearchHits({
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
    onWarning: warningReporter,
  }), searchStats);

  return {
    query: options.query,
    caseSensitive: options.filters.caseSensitive,
    hitStream: createLoggedInteractiveHitStream(
      trackedStream,
      searchStats,
      async (status, exitCode, error) => finishSearchLog(
        options.recordHistory === false ? async () => {} : options.writeSearchLog,
        options.writeEventLog,
        options.parsed.rootDir,
        logContext,
        status,
        exitCode,
        {
          hits: searchStats.hits,
          threads: searchStats.threadIds.size,
        },
        searchStats.progress,
        error,
      ),
    ),
    cancelSearch: () => searchAbortController.abort(),
    sourceLabel: formatSourceLabel(options.filters.sourceMode),
    rangeLabel: formatTuiRangeLabel(options.filters),
    cwdLabel: options.parsed.cwd ?? undefined,
    searchState,
  };
}

async function* createLoggedInteractiveHitStream(
  hitStream: AsyncIterable<SearchHit>,
  stats: SearchRunStats,
  finish: (status: SearchLogStatus, exitCode: number, error?: unknown) => Promise<void>,
): AsyncGenerator<SearchHit> {
  let status: SearchLogStatus = "completed";
  let exitCode = 0;
  let errorValue: unknown;

  try {
    for await (const hit of hitStream) {
      yield hit;
    }
  } catch (error) {
    status = "failed";
    exitCode = 1;
    errorValue = error;
    throw error;
  } finally {
    if (status !== "failed" && !stats.completed) {
      status = "cancelled";
    }
    await finish(status, exitCode, errorValue);
  }
}

async function runInteractiveLuckySearch(options: {
  parsed: ParsedArgs;
  query: string;
  filters: TuiSearchFilters;
  now: Date | undefined;
  openUrl: (url: string) => Promise<void>;
  writeSearchLog: (codexHomeDir: string | null | undefined, record: SearchLogRecord) => Promise<void>;
  writeEventLog: (codexHomeDir: string | null | undefined, record: EventLogRecord) => Promise<void>;
}): Promise<{ opened: boolean; message?: string }> {
  const searchOptions = buildSearchOptionsFromTuiFilters(
    options.parsed,
    options.query,
    options.filters,
    options.now,
  );
  const logContext = createSearchLogContextForTui(
    "lucky",
    options.parsed,
    options.query,
    options.filters,
    searchOptions,
  );
  const warningReporter = createSearchWarningReporter(
    options.writeEventLog,
    options.parsed.rootDir,
    "lucky",
    options.query,
  );

  try {
    const luckyHit = await findLuckyOpenableHit(searchOptions, options.filters.sourceMode, warningReporter);
    if (luckyHit) {
      await options.openUrl(luckyHit.deepLink);
      await finishSearchLog(options.writeSearchLog, options.writeEventLog, options.parsed.rootDir, logContext, "completed", 0, {
        hits: 1,
        threads: 1,
      }, null);
      await options.writeEventLog(options.parsed.rootDir, {
        version: 1,
        type: "event",
        time: new Date().toISOString(),
        severity: "info",
        event: "lucky_open",
        mode: "lucky",
        query: options.query,
        details: {
          sessionId: luckyHit.sessionId,
          source: luckyHit.source,
          deepLink: luckyHit.deepLink,
        },
      });
      return { opened: true };
    }

    const archivedHit = await findLuckyArchivedHit(searchOptions, options.filters.sourceMode, warningReporter);
    const message = archivedHit
      ? archivedUnavailableMessage(archivedHit)
      : "No matches found.";
    await finishSearchLog(options.writeSearchLog, options.writeEventLog, options.parsed.rootDir, logContext, "completed", 1, {
      hits: 0,
      threads: 0,
    }, null);
    return {
      opened: false,
      message,
    };
  } catch (error) {
    await finishSearchLog(options.writeSearchLog, options.writeEventLog, options.parsed.rootDir, logContext, "failed", 1, {
      hits: 0,
      threads: 0,
    }, null, error);
    throw error;
  }
}

async function findLuckyOpenableHit(
  searchOptions: Omit<SearchArchivedSessionsOptions, "page" | "pageSize">,
  sourceMode: ParsedArgs["sourceMode"],
  onWarning?: SearchArchivedSessionsOptions["onWarning"],
): Promise<SearchHit | null> {
  if (sourceMode === "archived") {
    return null;
  }

  const results = await searchArchivedSessions({
    ...searchOptions,
    sources: ["active"],
    page: 1,
    pageSize: 1,
    onWarning,
  });

  return results.hits[0] ?? null;
}

async function findLuckyArchivedHit(
  searchOptions: Omit<SearchArchivedSessionsOptions, "page" | "pageSize">,
  sourceMode: ParsedArgs["sourceMode"],
  onWarning?: SearchArchivedSessionsOptions["onWarning"],
): Promise<SearchHit | null> {
  if (sourceMode === "active") {
    return null;
  }

  const results = await searchArchivedSessions({
    ...searchOptions,
    sources: ["archived"],
    page: 1,
    pageSize: 1,
    onWarning,
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
