# codex-search

Search local Codex session JSONL files from the command line.

## Install

```bash
npm install -g codex-search
```

This package installs the `codexs` command.

## Usage

```bash
codexs <keyword> [--active|--archived] [--recent <duration>|--start <YYYY-MM-DD> --end <YYYY-MM-DD>] [-i]
codexs <keyword> --json [--active|--archived] [--recent <duration>|--start <YYYY-MM-DD> --end <YYYY-MM-DD>] [-p <page>] [-n <page-size>] [-o <offset>] [--with-total] [-i]
codexs lucky <keyword> [--active|--archived] [--recent <duration>|--start <YYYY-MM-DD> --end <YYYY-MM-DD>] [-i]
```

Examples:

```bash
codexs quota
codexs quota --active
codexs quota --archived
codexs quota --recent 7d
codexs quota --start 2026-04-01 --end 2026-04-15
codexs quota --json
codexs quota --json -n 20
codexs quota --json -p 2
codexs quota --json -o 40 --with-total
codexs lucky quota
codexs QUOTA -i
```

Default behavior:

- Searches both active and archived sessions under `~/.codex`
- Active source: `~/.codex/sessions/**/*.jsonl`
- Archived source: `~/.codex/archived_sessions/**/*.jsonl`
- Launches an interactive TUI when stdout is a TTY
- Matches case-insensitively

Supported options:

- `--active`: search active sessions only
- `--archived`: search archived sessions only
- `--json`: print machine-readable JSON instead of launching the TUI
- `-n, --limit <N>`: JSON mode only. page size
- `-p, --page <N>`: JSON mode only. 1-based page number
- `-o, --offset <N>`: JSON mode only. 0-based result offset
- `--with-total`: JSON mode only. include an exact total count
- `-i, --case-sensitive`: enable case-sensitive matching
- `--recent <duration>`: filter by relative time using `m`, `h`, `d`, or `w`
- `--start <YYYY-MM-DD>`: local-date lower bound
- `--end <YYYY-MM-DD>`: local-date upper bound

Development-only option:

- `--root-dir <PATH>`: override the Codex home directory root for testing

## TUI

`codexs <keyword>` opens an interactive picker by default.

Key bindings:

- `Enter`: open the selected thread in Codex Desktop
- `r`: run `codex resume <session_id>`
- `Space`: expand or collapse the selected thread details inline
- `j/k` or `Up/Down`: move one thread
- `Ctrl+d` / `Ctrl+u`: move half a page
- `PageDown` / `PageUp`: move a full page
- `g` / `G`: jump to the first or last thread
- `q` / `Esc`: quit

The TUI groups repeated keyword hits by thread. Expanding a thread shows its `cwd`, `open`, `resume`, and the first few matching snippets inline.

## Lucky Mode

Use `codexs lucky <keyword>` to open the newest matching thread directly in Codex Desktop.

Behavior:

- no matches: exits with an error
- one or more matches: opens the newest matching `codex://threads/<session_id>`

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

## Skill

This repo includes a companion Codex skill at `skills/codexs-usage` for routing thread-history questions to `codexs`.

## Notes

- It searches JSONL sessions under `~/.codex`, not Desktop binary cache files.
- Search is stream-based and does not require a separate index.
- Non-TTY usage requires `--json`.
