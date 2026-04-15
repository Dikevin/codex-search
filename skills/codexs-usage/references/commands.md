# codexs Command Map

## Basic search

- `codexs quota`
- `codexs quota --json`
- `codexs quota --json -n 20`
- `codexs quota --json -p 2`
- `codexs quota --json -o 40 --with-total`

## Source filters

- `codexs quota --active`
- `codexs quota --archived`

## Time filters

- `codexs quota --recent 30m`
- `codexs quota --recent 7d`
- `codexs quota --start 2026-04-01 --end 2026-04-15`

## Direct open

- `codexs lucky quota`

## TUI keys

- `Enter` open selected thread
- `r` resume selected thread in CLI
- `Space` expand or collapse selected thread details
- `j/k` or `Up/Down` move one thread
- `Ctrl+d` / `Ctrl+u` move half a page
- `PageDown` / `PageUp` move a full page
- `g` / `G` jump to the first or last thread
- `q` / `Esc` quit

## Result actions

- `resume: codex resume <session_id>`
- `open: codex://threads/<session_id>`
