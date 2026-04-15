# codex-search

Search and reopen local Codex thread history from the command line.

## Install

```bash
npm install -g codex-search
```

This package installs the `codexs` command.

## Local Development

Run from source:

```bash
pnpm install
pnpm exec tsx src/cli.ts --help
pnpm exec tsx src/cli.ts quota
```

Build the distributable CLI:

```bash
pnpm build
node dist/cli.js --help
node dist/cli.js quota
```

Link a local global `codexs` command:

```bash
pnpm build
npm link
codexs --help
codexs quota
```

Remove the local global link:

```bash
npm unlink -g codex-search
hash -r
```

## Usage

```bash
codexs [search-flags]
codexs <keyword>
codexs lucky <keyword>
codexs history
codexs history clear
codexs history enable
codexs history disable
codexs <keyword> --json [json-flags]
codexs <keyword> --jsonl
codexs -- <keyword-starting-with-dash>
```

Examples:

```bash
codexs quota
codexs quota --active
codexs quota --archived
codexs quota --all
codexs quota -D .
codexs quota --cwd ~/code/codex
codexs quota --recent 7d
codexs quota --start 2026-04-01 --end 2026-04-15
codexs quota --all-time
codexs quota --json
codexs quota --jsonl
codexs history
codexs history --json
codexs history disable
codexs quota --view ops
codexs quota --view protocol
codexs quota --json -n 20
codexs quota --json -p 2
codexs quota --json -o 40 --with-total
codexs -- --all
codexs lucky quota
codexs QUOTA -i
```

Default behavior:

- Searches active sessions from the last 30 days under `~/.codex`
- Active source: `~/.codex/sessions/**/*.jsonl`
- Archived source: `~/.codex/archived_sessions/**/*.jsonl`
- Thread titles are read from `~/.codex/state_5.sqlite` when available
- Launches an interactive TUI when stdout is a TTY
- Bare `codexs` enters a TUI home screen on a TTY, with a bottom search dock and the current global filters ready before you type a keyword
- Matches case-insensitively
- Streams matching threads into the TUI while each file is scanned
- Uses a worker-backed search pool by default when multiple files need scanning
- Writes explicit search history to `~/.codex/logs/codex-search/searches.jsonl`
- Writes action and diagnostic events to `~/.codex/logs/codex-search/events.jsonl`
- Prints the same full help text for bare `codexs` as `codexs --help` when stdout is not a TTY
- Suggests close matches for mistyped commands and flags
- Shows the `useful` view by default, hiding low-signal protocol and raw tool-call noise

Shared search flags:

- `--active`: search active sessions only. This is the default.
- `--archived`: search archived sessions only. Archived results are searchable but cannot be reopened directly.
- `--all`: search active and archived sessions
- `--view <MODE>`: choose `useful` (default), `ops`, `protocol`, or `all`
- `-D, --cwd <PATH>`: filter to threads whose recorded cwd is this path or a subdirectory
- `--recent <duration>`: filter by relative time using `m`, `h`, `d`, or `w`. Default: `30d`
- `--start <YYYY-MM-DD>`: local-date lower bound
- `--end <YYYY-MM-DD>`: local-date upper bound
- `--all-time`: search without the default 30-day time window
- `-i, --case-sensitive`: enable case-sensitive matching

JSON flags:

- `--json`: print machine-readable JSON instead of launching the TUI
- `--jsonl`: print streaming JSONL events for large result sets and pipelines
- `-n, --limit <N>`: JSON mode only. page size
- `-p, --page <N>`: JSON mode only. 1-based page number
- `-o, --offset <N>`: JSON mode only. 0-based result offset
- `--with-total`: JSON mode only. include an exact total count

Development-only option:

- `--root-dir <PATH>`: override the Codex home directory root for testing

Use `--` before the keyword when the keyword itself starts with a dash, for example `codexs -- --all`.

## TUI

`codexs` or `codexs <keyword>` opens the interactive picker by default on a TTY.

Key bindings:

- Home screen: type a keyword directly
- `Enter`: run a search from the home screen or the global search prompt; otherwise open the selected active thread in Codex Desktop
- `Ctrl+o`: run a lucky search for the current keyword; when preview results are visible, it opens the first preview hit immediately
- `f`: open the global filter picker; changes become the new default state for later searches in the same TUI session
- `s`: reopen the global search prompt with the current keyword prefilled
- `Tab`: while searching, accept the selected `recent` or `project` suggestion into the input; otherwise switch focus between the thread list and the expanded transcript preview
- `Up/Down`: while searching, move between `preview`, `recent`, and `project` suggestions
- `1-5`: open the numbered preview result directly when preview results are visible
- `Backspace/Delete`: remove the selected `recent` entry while the suggestion list is focused
- `o`: open the selected active thread in Codex Desktop and keep the picker open
- `r`: run `codex resume <session_id>` for the selected active thread
- `Space`: expand or collapse the selected thread details; opening details moves focus into the transcript preview immediately
- `j/k` or `Up/Down`: move one thread
- `Ctrl+d` / `Ctrl+u`: move half a page
- `PageDown` / `PageUp`: move a full page
- `g` / `G`: jump to the first or last thread
- `l` / `Right`: move focus into the expanded transcript preview
- `h` / `Left`: move focus back to the thread list
- In transcript focus, `Ctrl+d` / `Ctrl+u`, `PageDown` / `PageUp`, and `g` / `G` page inside the preview instead of moving the thread list
- `/`: search within the expanded transcript preview
- `n` / `N`: jump to the next or previous transcript-search match
- `q` / `Esc`: quit, except that `Esc` first cancels the active search prompt or filter picker

The TUI groups repeated keyword hits by thread, not by `cwd`. Results render inside a centered panel so the first data row does not sit on the terminal's top edge. The list uses fixed-width columns with an English header row, prefers the Codex thread title when available, truncates by terminal display width so long CJK titles do not wrap and push earlier rows off screen, and inserts lightweight time bucket separators such as `[<1d]`, `[<3d]`, and `[<1w]` between age groups. With no keyword yet, the picker shows a centered home screen in the upper body and keeps the active search input in a bottom dock above the status bar. That same bottom dock is reused for `s` restart-search prompts, and it can show `preview`, `recent`, and `project` sections above it. Pressing `f` opens a bottom overlay filter picker with a row selector and value selector; changes update the session-global source/time/view/case filters, and a close with no effective change does not retrigger search. Expanding a thread shows a compact metadata header plus a typed transcript preview that favors a representative summary in the list while keeping detail hits in reverse-chronological reading order. Detail headers prioritize thread-level context such as match count, message count, session id, reopenability state, and reopen actions; when the panel is tall enough, they also include `cwd`. Wide terminals use a side-by-side list/detail layout that gives the transcript pane more width; narrow terminals stack details below the list, clamp preview counts, and split bottom query/filter context across two lines when needed. Terminal resize events trigger a redraw.

Search runs as a single streamed scan per file: the first matching line can put a thread into the picker immediately, and later matches from that same thread continue to update while scanning is still in progress. When multiple files need scanning, `codexs` uses a worker-thread pool so different session files can scan on multiple CPU cores instead of a single event-loop lane. The footer shows an animated global search state plus thread counts, match counts, selected row, visible row range, and detail-position summaries such as `detail 3/12`. Query text and filter context stay in the bottom search dock above the status bar rather than in the footer itself. Home and restart-search input also support debounced lightweight preview search: after roughly 200ms and at least two characters, `codexs` previews a few recent matching threads without writing history; `Enter` still starts the full search.

While searching, the footer uses count-based progress such as `scan 12/43` instead of a percentage, because session files vary widely in size and percentages would look precise without being accurate. The bottom status line intentionally avoids current-thread metadata such as per-thread scan state or thread-local labels; thread-specific context stays in the detail header.

Expanded transcript previews preserve meaningful line breaks, sanitize terminal control characters, and open directly into detail focus when you press `Space`. `Tab` is the primary focus switch; `l` / `Right` and `h` / `Left` remain directional aliases. When details are open but focus is back on the list, moving the selection updates the preview pane to the currently selected thread. Once transcript focus is active, `j/k` moves through visible matches before the pane scrolls, paging keys and `/` search operate inside the preview instead of the outer thread list, and cross-day match timestamps expand from `HH:mm` to `MM-DD HH:mm` when needed.

Archived threads are read-only in `codexs`: they can appear with `--archived` or `--all`, but `Enter` and `r` show a warning instead of trying to reopen them.

## Shell Completion

Generate a completion script and install it with your shell's standard mechanism:

```bash
mkdir -p ~/.zsh/completions
codexs completion zsh > ~/.zsh/completions/_codexs

mkdir -p ~/.local/share/bash-completion/completions
codexs completion bash > ~/.local/share/bash-completion/completions/codexs
```

The generated scripts complete:

- commands such as `lucky` and `completion`
- command-specific flags, so `lucky` does not advertise JSON-only pagination flags
- recorded Codex cwd values plus filesystem directories for `-D/--cwd`
- directory-valued options such as `--root-dir`
- common `--recent` values by calling back into `codexs completion --durations`

For debugging or custom shell glue, `codexs completion --cwds` prints the recorded cwd candidates directly.

## Lucky Mode

Use `codexs lucky <keyword>` to open the newest matching active thread directly in Codex Desktop.

Behavior:

- no matches: exits with an error
- active matches: opens the newest matching `codex://threads/<session_id>`
- archived-only matches: exits with an explanatory error because archived threads cannot be reopened directly

## JSON Output

Use `--json` for scripting, pipes, or non-TTY output.

Example shape:

```json
{
  "page": 1,
  "pageSize": 5,
  "offset": 0,
  "hasMore": true,
  "total": 12,
  "hits": []
}
```

`total` is only included when `--with-total` is set.

## JSONL Output

Use `--jsonl` for large result sets or stream processing. It emits one JSON object per line:

```json
{"type":"progress","progress":{"readyFiles":1,"totalFiles":4}}
{"type":"hit","hit":{}}
{"type":"summary","hits":12,"threads":4,"view":"useful","progress":{}}
```

JSONL mode is not paginated and does not support `--page`, `--page-size`, `--limit`, `--offset`, or `--with-total`. Progress events are count-only and omit per-file path state.

## Search Logs

`codexs` keeps two JSONL log files under `~/.codex/logs/codex-search/`:

- `searches.jsonl`: explicit search history that powers `recent` suggestions
- `events.jsonl`: explicit actions plus warnings and errors

`searches.jsonl` records:

- query, mode, source/view/time/cwd flags
- duration, exit code, and status: `completed`, `cancelled`, or `failed`
- result counts: hits, threads, pagination metadata when relevant
- final count-based file progress when available

`events.jsonl` records:

- session lifecycle such as `session_start` and `session_end`
- explicit actions such as `preview_open`, `desktop_open`, `resume`, `lucky_open`, and history management commands
- warning/error events such as file read failures and thread-title lookup failures
- `search_run` summaries for full searches, including performance and result counts

Preview searches do not write search history. Directly opening a preview result writes an event but does not create a `recent` query entry.

Use `codexs history`, `codexs history clear`, `codexs history enable`, and `codexs history disable` to inspect or manage explicit search history. Disabling history hides `recent` suggestions and stops new writes to `searches.jsonl`, while event logging continues.

The full schema and event enum reference lives in [docs/logging.md](docs/logging.md).

## View Modes

`--view useful` is the default. It keeps user-facing conversation content and meaningful command/output matches while hiding raw tool-call JSON, duplicate agent events, developer/system/reasoning messages, and skill or AGENTS prompt material.

`--view ops` includes `useful` plus operational details such as raw tool calls.

`--view protocol` shows protocol and prompt material, including developer/system/reasoning/session metadata and skill or AGENTS content.

`--view all` disables view filtering.

## Skill

This repo includes a companion Codex skill at `skills/codexs-usage` for routing thread-history questions to `codexs`.

## Notes

- It searches thread JSONL files under `~/.codex`, not Desktop binary cache files.
- Search is stream-based and does not require a separate index or persistent result cache.
- Time filters are applied twice: first as a cheap file-level prefilter, then against each matching line's own timestamp so older content inside an otherwise recent session is excluded.
- `codexs` does not write persistent search or completion caches.
- Non-TTY usage requires `--json` or `--jsonl`.
- Opening Desktop links uses the host opener command: `open` on macOS, `xdg-open` on Linux, and `wslview` with `xdg-open` fallback on WSL. Linux/WSL may need those tools installed for `codex://` links to work.

## TODO

- Optional title-aware search mode so thread titles can contribute matches instead of only receiving highlight treatment in the list/detail view.
