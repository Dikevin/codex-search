# codexs Command Map

## Basic search

- `codexs quota`
- `codexs quota -D .`
- `codexs quota --cwd ~/code/codex`
- `codexs quota --json`
- `codexs quota --jsonl`
- `codexs quota --view ops`
- `codexs quota --view protocol`
- `codexs quota --json -n 20`
- `codexs quota --json -p 2`
- `codexs quota --json -o 40 --with-total`

## Shell completion

- `codexs completion zsh`
- `codexs completion bash`
- `codexs completion --durations`
- `codexs completion --cwds`

## Source filters

- `codexs quota --active`
- `codexs quota --archived`
- `codexs quota --all`

## Time filters

- `codexs quota --recent 30m`
- `codexs quota --recent 7d`
- `codexs quota --start 2026-04-01 --end 2026-04-15`
- `codexs quota --all-time`

## Direct open

- `codexs lucky quota`

## TUI keys

- `Enter` open selected active thread
- `o` open selected active thread and stay in the picker
- `r` resume selected active thread in CLI
- `Space` expand or collapse selected thread details and move focus into the preview when opening
- `Tab` switch focus between the thread list and the expanded transcript preview
- `l` or `Right` move focus into the expanded transcript preview
- `h` or `Left` move focus back to the thread list
- `j/k` or `Up/Down` move one thread
- `Ctrl+d` / `Ctrl+u` move half a page
- `PageDown` / `PageUp` move a full page
- `g` / `G` jump to the first or last thread
- `/` search inside the expanded transcript preview
- `n` / `N` jump to the next or previous transcript-search match
- `q` / `Esc` quit

## Result actions

- `resume: codex resume <session_id>`
- `open: codex://threads/<session_id>`
- Archived results are read-only and cannot be reopened directly.

## TUI layout

- Results are grouped by thread, not by individual matching line.
- Results are not grouped by cwd; cwd is shown as context.
- The default view is `useful`, which hides raw tool-call JSON and protocol prompt noise.
- `--view ops` adds raw operational/tool-call detail.
- `--view protocol` focuses developer/system/reasoning/session metadata and skill or AGENTS prompt material.
- `--view all` disables view filtering.
- The list includes an English header row with fixed-width columns.
- On wider terminals, cwd appears before the thread title.
- The list inserts lightweight time bucket separators such as `[<1d]` and `[<1w]`.
- The picker renders inside a centered panel instead of drawing data directly against the terminal edge.
- Rows prefer Codex thread titles when available.
- Matching threads start appearing as soon as each file produces hits, and later hits from those threads keep streaming in while search continues.
- Multi-file scans use worker threads by default, so different session files can be searched in parallel.
- The footer shows an animated global search state plus count-based scan progress such as `scan 12/43`; it keeps list/viewport summaries such as `selected`, `visible`, and `detail`, but avoids current-thread metadata or per-thread scan state.
- Expanded details use a responsive panel.
- Expanded details show a compact metadata header plus typed transcript previews, preserve meaningful line breaks, can wrap across multiple lines, and show thread-local context such as match count and message count in the detail header instead of the footer.
- When details stay open but focus returns to the list, moving the selection updates the preview pane to the currently selected thread.
- Once transcript focus is active, `j/k` moves through visible matches before the preview scrolls, paging keys and `/` search operate inside the preview instead of the thread list, and cross-day preview timestamps expand beyond bare `HH:mm`.
- Wide terminals show list and details side by side.
- Narrow terminals stack details below the list and keep the footer visible.
- Resizing the terminal redraws the picker.

## Search logs

- `codexs` does not write persistent search or completion caches.
- Each search appends one metadata-only JSONL record to `~/.codex/logs/codex-search/searches.jsonl`.
- Log records include query, flags, mode, status, duration, exit code, result counts, and final count-based file progress.
- Log records do not include snippets, transcript text, file paths, or per-hit details.
- Time filters are checked again against each matching line's timestamp, so older content inside a newer session file can still be excluded.

## JSONL output

- `--jsonl` emits one JSON object per line.
- JSONL event types are `progress`, `hit`, and `summary`.
- JSONL is intended for large result sets and streaming pipelines.
- JSONL does not support `--page`, `--page-size`, `--limit`, `--offset`, or `--with-total`; use `--json` for paginated output.

## Desktop Openers

- macOS: `open`
- Linux: `xdg-open`
- WSL: `wslview`, with `xdg-open` fallback
