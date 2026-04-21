---
name: codexs-usage
description: Use when a user wants help searching local Codex thread history with the codexs CLI, including the default TUI picker, bottom search dock suggestions, JSON output, lucky open, history management, active versus archived filtering, recent time windows, date ranges, and jumping back into a matching thread.
---

# codexs Usage

Use this skill when the user wants to find or reopen a local Codex thread with `codexs`. Do not use it for implementing `codex-search` itself.

## How to use

1. Identify whether the user wants the interactive picker, JSON output, JSONL streaming output, the newest matching thread, search history management, shell completion, or a CLI resume command.
2. Prefer the shortest command that satisfies the request.
3. Default to active sessions in the last 30 days, because active recent threads are the reopenable fast path.
4. When the user wants to browse results in a terminal, prefer `codexs <keyword>` and explain that it opens a TUI picker by default. If they want to start from a blank picker and type later, use bare `codexs`.
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
- If the user asks how to move inside the picker, mention `j/k`, `Up/Down`, `Ctrl+d/u`, `PageUp/PageDown`, `g/G`, `Space`, `Tab`, `l/h`, `/`, `n/N`, `Enter`, `Ctrl+o`, `o`, `r`, `s`, `f`, `Ctrl+f`, `1-5`, and `q`. `Space` opens details and moves focus into the preview immediately; `Tab` is the primary focus switch, and while the bottom search dock is active it accepts the selected `recent` or `project` suggestion; `s` reopens the global search prompt; `f` opens the global filter picker from the list and `Ctrl+f` opens it while the search prompt is active; `r` resumes into `codex` and returns to `codexs` when `codex` exits; `Esc` is the back/cancel key, so it closes prompts and pickers, returns detail focus to the list, and returns the result list to the home screen; `q` is the explicit quit key outside active text prompts; `1-5` moves the numbered preview thread into the formal result list and preselects it instead of reopening it directly; and the active prompt supports `Ctrl+a`, `Ctrl+e`, `Ctrl+u`, `Ctrl+k`, `Ctrl+w`, `Left/Right`, and `Home/End` for line editing, with `Option+Left/Right` working on terminals that emit Meta word-motion keys.
- If the user asks about display behavior, explain that results are thread-level, not cwd-grouped; rows prefer Codex thread titles; the list has fixed-width columns with an English header row inside a centered panel; cwd appears before title on wider terminals; lightweight time bucket separators break up older rows; bare `codexs` opens a centered home screen in the upper body and keeps the active search input in a bottom dock above the status bar; that dock can show `preview`, `recent`, and `project` sections while typing; preview entries are thread summaries that include a cumulative match count plus a representative match line, and submitting the search seeds the formal result list from those preview threads before the full stream catches up; matching threads start appearing as soon as each file produces hits, and additional matches from those threads continue streaming in while search runs; the footer shows an animated global search state and count-based scan progress such as `scan 12/43`, keeps list/viewport summaries such as `selected`, `visible`, and `detail`, but intentionally does not show current-thread metadata or per-thread scan state; expanded details use a compact metadata header plus a typed transcript-style preview instead of raw plain-text snippets, and that header can include session id, reopenability/read-only state, and `resume:` / `open:` actions when the panel is tall enough; when details are open but focus is back on the list, moving the selection updates the preview pane to the currently selected thread; inside transcript focus, `j/k` moves through visible matches before the pane scrolls, while paging keys and `/` search work inside the transcript view; filter changes become the default state for later searches in the same TUI session.
- If the user asks about repeated searches being fast, mention that `codexs` does not write persistent search or completion caches; it scans local JSONL history each time, uses a worker-backed pool by default when multiple files need scanning, and uses a debounced lightweight preview search in the TUI before a full submitted search.
- If the user asks about search logs, mention that `~/.codex/logs/codex-search/searches.jsonl` stores explicit search history for `recent` suggestions, while `~/.codex/logs/codex-search/events.jsonl` stores explicit actions plus warnings and errors. Preview searches do not write history. The full schema is documented in `docs/logging.md`.
- If the user asks about history privacy, route them to `codexs history`, `codexs history clear`, `codexs history enable`, and `codexs history disable`.
- If the user asks how time filters work, explain that `--recent`, `--start`, and `--end` use both file-level prefiltering and each matching line's own timestamp, so stale content inside a newer session file can still be excluded.
- If the user asks for shell completion, route them to `codexs completion <zsh|bash>` and mention that the generated script completes commands, `history` actions, command-specific flags after `-` / `--`, recorded cwd values plus filesystem directories for `-D/--cwd`, and common `--recent` values via `codexs completion --durations`.
- If the user asks about platform compatibility, mention that Desktop open actions use `open` on macOS, `xdg-open` on Linux, and prefer `wslview` on WSL with `xdg-open` fallback.
- If the user wants raw command help only, answer with commands first and keep explanation short.
