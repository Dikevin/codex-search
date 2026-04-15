# Logging Schema

`codexs` writes metadata-only JSONL logs under `~/.codex/logs/codex-search/`.

## Files

| File | Purpose |
| --- | --- |
| `searches.jsonl` | Explicit search history that powers `recent` suggestions |
| `events.jsonl` | Action, session, warning, and error events |
| `~/.codex/codex-search/config.json` | Persistent local config, currently only search-history enablement |

## `searches.jsonl`

Each line is a `SearchLogRecord`.

### Enums

| Name | Values |
| --- | --- |
| `SearchLogMode` | `tui`, `json`, `jsonl`, `lucky` |
| `SearchLogStatus` | `completed`, `cancelled`, `failed` |
| `sourceMode` | `active`, `archived`, `all` |
| `view` | `useful`, `ops`, `protocol`, `all` |

### Shape

```json
{
  "version": 1,
  "type": "search",
  "startedAt": "2026-04-16T01:00:00.000Z",
  "endedAt": "2026-04-16T01:00:01.000Z",
  "durationMs": 1000,
  "mode": "json",
  "status": "completed",
  "exitCode": 0,
  "query": "quota",
  "flags": {
    "sourceMode": "active",
    "sources": ["active"],
    "view": "useful",
    "caseSensitive": false,
    "cwd": null,
    "recent": "30d",
    "start": null,
    "end": null,
    "allTime": false,
    "json": true,
    "jsonl": false,
    "page": 1,
    "pageSize": 5,
    "offset": 0,
    "withTotal": false
  },
  "results": {
    "hits": 1,
    "threads": 1,
    "page": 1,
    "pageSize": 5,
    "offset": 0,
    "hasMore": false
  },
  "progress": null,
  "error": null
}
```

### Rules

- Only explicit submitted searches should land here.
- Preview searches do not write `searches.jsonl`.
- Automatic filter-refresh re-searches do not write `searches.jsonl`.
- This file is the only source for `recent` query suggestions and `codexs history`.

## `events.jsonl`

Each line is an `EventLogRecord`.

### Enums

| Name | Values |
| --- | --- |
| `EventSeverity` | `info`, `warn`, `error` |
| `EventName` | `session_start`, `session_end`, `search_run`, `preview_open`, `lucky_open`, `desktop_open`, `resume`, `history_delete`, `history_clear`, `history_enabled`, `history_disabled`, `file_read_failed`, `thread_title_unavailable`, `desktop_open_failed`, `resume_failed`, `search_root_unavailable` |
| `mode` | `tui`, `json`, `jsonl`, `lucky`, `preview`, `history`, `tui-session` |

### Shape

```json
{
  "version": 1,
  "type": "event",
  "time": "2026-04-16T01:00:01.000Z",
  "severity": "info",
  "event": "preview_open",
  "sessionId": "52d4f9f4-3ff4-49bb-8d18-55b01bd6eaea",
  "mode": "tui",
  "query": "quota",
  "details": {
    "sessionId": "thread-active-aaa",
    "source": "active",
    "deepLink": "codex://threads/thread-active-aaa"
  }
}
```

### Event Detail Conventions

| Event | Severity | Typical `details` |
| --- | --- | --- |
| `session_start` | `info` | `query`, `width`, `height`, `sourceMode`, `view`, `caseSensitive`, `range` |
| `session_end` | `info` | `exitCode`, `durationMs` |
| `search_run` | `info` or `error` | `status`, `exitCode`, `results`, `progress`, `flags`, optional `error` |
| `preview_open` | `info` | `sessionId`, `source`, `deepLink` |
| `desktop_open` | `info` | `sessionId`, `source`, `deepLink` |
| `lucky_open` | `info` | `sessionId`, `source`, `deepLink` |
| `resume` | `info` | `targetSessionId`, `exitCode` |
| `history_delete` | `info` | none beyond top-level `query` |
| `history_clear` | `info` | none |
| `history_enabled` | `info` | none |
| `history_disabled` | `info` | none |
| `file_read_failed` | `warn` | `filePath`, `code`, `message` |
| `thread_title_unavailable` | `warn` | `dbPath`, `code`, `message` |
| `desktop_open_failed` | `error` | `sessionId`, `source`, `deepLink`, `error` |
| `resume_failed` | `error` | `targetSessionId`, `exitCode` or `error` |
| `search_root_unavailable` | `error` | implementation-defined root/path error context |

### Rules

- Preview searches themselves do not write `events.jsonl` search-run entries.
- Explicit preview opens do write `preview_open`.
- Recoverable per-file read failures should be logged as `warn`, not as fatal search failures.
- Repeated warnings for the same file/code pair should be deduplicated per search run.

## Config

Config lives at `~/.codex/codex-search/config.json`.

### Shape

```json
{
  "version": 1,
  "history": {
    "enabled": true
  }
}
```

### Current fields

| Field | Meaning |
| --- | --- |
| `history.enabled` | Whether explicit search history is stored and whether `recent` suggestions are shown |
