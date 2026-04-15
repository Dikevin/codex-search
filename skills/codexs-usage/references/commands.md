# codexs Command Map

## Basic search

- `codexs quota`
- `codexs quota -n 5`
- `codexs quota --json`

## Source filters

- `codexs quota --active`
- `codexs quota --archived`

## Time filters

- `codexs quota --recent 30m`
- `codexs quota --recent 7d`
- `codexs quota --start 2026-04-01 --end 2026-04-15`

## Direct open

- `codexs lucky quota`

## Result actions

- `resume: codex resume <session_id>`
- `open: codex://threads/<session_id>`
