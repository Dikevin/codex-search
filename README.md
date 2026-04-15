# codex-search

Search Codex session JSONL files from the command line.

## Install

```bash
npm install -g codex-search
```

This package installs the `codexs` command.

## Usage

```bash
codexs <keyword> [--active|--archived] [--recent <duration>|--start <YYYY-MM-DD> --end <YYYY-MM-DD>] [--json] [-n <limit>] [-i]
codexs lucky <keyword> [--active|--archived] [--recent <duration>|--start <YYYY-MM-DD> --end <YYYY-MM-DD>] [-n <limit>] [-i]
```

Examples:

```bash
codexs quota
codexs lucky quota
codexs quota --active
codexs quota --archived
codexs quota --recent 7d
codexs quota --start 2026-04-01 --end 2026-04-15
codexs quota -n 5
codexs quota --json
codexs QUOTA -i
```

Default behavior:

- Searches both active and archived sessions under `~/.codex`
- Active source: `~/.codex/sessions/**/*.jsonl`
- Archived source: `~/.codex/archived_sessions/**/*.jsonl`
- Matches case-insensitively
- Returns up to `20` hits

Supported options:

- `--active`: search active sessions only
- `--archived`: search archived sessions only
- `--json`: print machine-readable JSON
- `-n, --limit <N>`: limit result count
- `-i, --case-sensitive`: enable case-sensitive matching
- `--recent <duration>`: filter by relative time using `m`, `h`, `d`, or `w`
- `--start <YYYY-MM-DD>`: local-date lower bound
- `--end <YYYY-MM-DD>`: local-date upper bound

Development-only option:

- `--root-dir <PATH>`: override the Codex home directory root

## Output

Each hit includes:

- source (`active` or `archived`)
- Session timestamp
- `session_id`
- `cwd`
- matched text snippet
- `codex resume <session_id>`
- `codex://threads/<session_id>`

## Lucky Mode

Use `codexs lucky <keyword>` to open the newest matching thread directly in Codex Desktop.

Behavior:

- no matches: exits with an error
- one or more matches: opens the newest matching `codex://threads/<session_id>`

## Skill

This repo includes a companion Codex skill at `skills/codexs-usage` for routing thread-history questions to `codexs`.

## Notes

- It searches JSONL sessions under `~/.codex`, not Desktop binary cache files.
- Search is stream-based and does not require a separate index.
