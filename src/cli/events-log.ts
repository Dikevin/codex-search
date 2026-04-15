import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { SearchLogMode } from "./search-log.js";

export type EventSeverity = "info" | "warn" | "error";

export type EventName =
  | "session_start"
  | "session_end"
  | "search_run"
  | "preview_open"
  | "lucky_open"
  | "desktop_open"
  | "resume"
  | "history_delete"
  | "history_clear"
  | "history_enabled"
  | "history_disabled"
  | "file_read_failed"
  | "thread_title_unavailable"
  | "desktop_open_failed"
  | "resume_failed"
  | "search_root_unavailable";

export interface EventLogRecord {
  version: 1;
  type: "event";
  time: string;
  severity: EventSeverity;
  event: EventName;
  sessionId?: string | null;
  mode?: SearchLogMode | "preview" | "history" | "tui-session";
  query?: string | null;
  details?: Record<string, unknown>;
}

const EVENT_LOG_DIR = "logs/codex-search";
const EVENT_LOG_NAME = "events.jsonl";

export async function appendEventLog(
  codexHomeDir: string | null | undefined,
  record: EventLogRecord,
): Promise<void> {
  const logPath = getEventLogPath(codexHomeDir);

  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Event logging is best-effort.
  }
}

export function getEventLogPath(codexHomeDir: string | null | undefined): string {
  return join(codexHomeDir ?? join(homedir(), ".codex"), EVENT_LOG_DIR, EVENT_LOG_NAME);
}
