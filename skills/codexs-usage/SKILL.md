---
name: codexs-usage
description: Use when a user wants help searching local Codex thread history with the codexs CLI, including the default TUI picker, JSON output, lucky open, active versus archived filtering, recent time windows, date ranges, and jumping back into a matching thread.
---

# codexs Usage

Use this skill when the user wants to find or reopen a local Codex thread with `codexs`. Do not use it for implementing `codex-search` itself.

## How to use

1. Identify whether the user wants the interactive picker, JSON output, JSONL streaming output, the newest matching thread, shell completion, or a CLI resume command.
2. Prefer the shortest command that satisfies the request.
3. Default to active sessions in the last 30 days, because active recent threads are the reopenable fast path.
4. When the user wants to browse results in a terminal, prefer `codexs <keyword>` and explain that it opens a TUI picker by default.
5. When the user needs a thread back in Desktop, prefer `codexs lucky <keyword>` or the returned `open:` deeplink.
6. When the user needs the CLI thread, use the returned `resume:` command.
7. Use `--archived` for archived-only recall and `--all` when the user explicitly wants active plus archived results. Archived results are searchable but cannot be reopened directly.
8. Use `codexs -- <keyword>` when the keyword itself starts with `-`, for example `codexs -- --all`.

## Route by task

- Command map: [references/commands.md](references/commands.md)

## Response Guidance

- For broad recall in a terminal, start with `codexs <keyword>`.
- For machine-readable output, include `--json`; mention that non-TTY use requires `--json` or `--jsonl`.
- For large result sets or stream processing, use `--jsonl`; it emits `progress`, `hit`, and `summary` events and is not paginated.
- Use `-n`, `-p`, `-o`, and `--with-total` only with `--json`.
- Use `--view useful` by default. Use `--view ops` for raw operational/tool-call detail, `--view protocol` for developer/system/reasoning/skill/AGENTS prompt material, and `--view all` to disable filtering.
- Use `-D, --cwd <PATH>` when the user wants to limit results to a project directory. It matches that directory and its subdirectories.
- Active-only search is the default; `--active` is only needed for explicitness. For archived-only searches, use `--archived`. For active plus archived searches, use `--all`.
- For relative time windows, use `--recent <duration>` where duration uses `m`, `h`, `d`, or `w`. The default is `--recent 30d`.
- For explicit date windows, use `--start <YYYY-MM-DD>` and `--end <YYYY-MM-DD>`.
- For full history, use `--all-time`.
- If the user wants the newest matching Desktop thread immediately, use `codexs lucky <keyword>`. This only opens active/reopenable threads.
- If the user asks how to move inside the picker, mention `j/k`, `Up/Down`, `Ctrl+d/u`, `PageUp/PageDown`, `g/G`, `Space`, `Tab`, `l/h`, `/`, `n/N`, `Enter`, `o`, `r`, and `q`. `Space` opens details and moves focus into the preview immediately; `Tab` is the primary focus switch.
- If the user asks about display behavior, explain that results are thread-level, not cwd-grouped; rows prefer Codex thread titles; the list has fixed-width columns with an English header row inside a centered panel; cwd appears before title on wider terminals; lightweight time bucket separators break up older rows; matching threads start appearing as soon as each file produces hits, and additional matches from those threads continue streaming in while search runs; the footer shows an animated global search state and count-based scan progress such as `scan 12/43`, keeps list/viewport summaries such as `selected`, `visible`, and `detail`, but intentionally does not show current-thread metadata or per-thread scan state; expanded details use a compact metadata header plus a typed transcript-style preview instead of raw plain-text snippets; when details are open but focus is back on the list, moving the selection updates the preview pane to the currently selected thread; inside transcript focus, `j/k` moves through visible matches before the pane scrolls, while paging keys and `/` search work inside the transcript view.
- If the user asks about repeated searches being fast, mention that `codexs` does not write persistent search or completion caches; it scans local JSONL history each time and uses a worker-backed pool by default when multiple files need scanning.
- If the user asks about search logs, mention that each search appends one metadata-only JSONL record to `~/.codex/logs/codex-search/searches.jsonl`, including query, flags, status, duration, exit code, result counts, and final count-based file progress. It does not log snippets or transcript text.
- If the user asks how time filters work, explain that `--recent`, `--start`, and `--end` use both file-level prefiltering and each matching line's own timestamp, so stale content inside a newer session file can still be excluded.
- If the user asks for shell completion, route them to `codexs completion <zsh|bash>` and mention that the generated script completes commands, command-specific flags, recorded cwd values plus filesystem directories for `-D/--cwd`, and common `--recent` values via `codexs completion --durations`.
- If the user asks about platform compatibility, mention that Desktop open actions use `open` on macOS, `xdg-open` on Linux, and prefer `wslview` on WSL with `xdg-open` fallback.
- If the user wants raw command help only, answer with commands first and keep explanation short.
