import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { JsonlSearchProgress } from "./output.js";
import type { SearchSource } from "../search/session-reader.js";
import type { SearchViewMode } from "../search/view-filter.js";

export type SearchLogMode = "tui" | "json" | "jsonl" | "lucky";
export type SearchLogStatus = "completed" | "cancelled" | "failed";

export interface SearchLogFlags {
  sourceMode: "all" | "active" | "archived";
  sources: SearchSource[];
  view: SearchViewMode;
  caseSensitive: boolean;
  cwd: string | null;
  recent: string | null;
  start: string | null;
  end: string | null;
  allTime: boolean;
  json: boolean;
  jsonl: boolean;
  page: number | null;
  pageSize: number | null;
  offset: number | null;
  withTotal: boolean;
}

export interface SearchLogResults {
  hits: number;
  threads: number;
  page?: number;
  pageSize?: number;
  offset?: number;
  hasMore?: boolean;
  total?: number;
}

export interface SearchLogRecord {
  version: 1;
  type: "search";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  mode: SearchLogMode;
  status: SearchLogStatus;
  exitCode: number;
  query: string;
  flags: SearchLogFlags;
  results: SearchLogResults;
  progress: JsonlSearchProgress | null;
  error?: string;
}

const SEARCH_LOG_DIR = "logs/codex-search";
const SEARCH_LOG_NAME = "searches.jsonl";

export async function appendSearchLog(
  codexHomeDir: string | null | undefined,
  record: SearchLogRecord,
): Promise<void> {
  const logPath = getSearchLogPath(codexHomeDir);

  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Search logging is best-effort and must not break search itself.
  }
}

export function getSearchLogPath(codexHomeDir: string | null | undefined): string {
  return join(codexHomeDir ?? join(homedir(), ".codex"), SEARCH_LOG_DIR, SEARCH_LOG_NAME);
}
