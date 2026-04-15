# codex-search

Search archived Codex session JSONL files from the command line.

## Install

```bash
npm install -g codex-search
```

This package installs the `codexs` command.

## Usage

```bash
codexs <keyword> [--json] [-n <limit>] [-i]
codexs lucky <keyword> [-n <limit>] [-i]
```

Examples:

```bash
codexs quota
codexs lucky quota
codexs quota -n 5
codexs quota --json
codexs QUOTA -i
```

Default behavior:

- Searches `~/.codex/archived_sessions/*.jsonl`
- Matches case-insensitively
- Returns up to `20` hits

Supported options:

- `--json`: print machine-readable JSON
- `-n, --limit <N>`: limit result count
- `-i, --case-sensitive`: enable case-sensitive matching

Development-only option:

- `--root-dir <PATH>`: override the archived session directory

## Output

Each hit includes:

- Session timestamp
- `session_id`
- `cwd`
- matched text snippet
- source JSONL file
- `codex resume <session_id>`
- `codex://threads/<session_id>`

## Lucky Mode

Use `codexs lucky <keyword>` to open the newest matching thread directly in Codex Desktop.

Behavior:

- no matches: exits with an error
- one or more matches: opens the newest matching `codex://threads/<session_id>`

## Notes

- `v1` searches archived JSONL sessions only.
- It does not index Desktop binary caches yet.
- Search is stream-based and does not require a separate index.
