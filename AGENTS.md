# codex-search AGENTS

This file contains repository-stable engineering constraints for agents.

## Guardrails

- Keep `codexs` focused on local Codex thread discovery and reopening. Do not add unrelated Codex account-management behavior.
- Do not add Desktop binary cache parsing while JSONL sources under `~/.codex` remain sufficient.
- Do not add config-file driven behavior until a user explicitly asks for persistent preferences.

## Module Boundaries

- `src/main.ts`: CLI orchestration only.
- `src/cli/*`: argument parsing, help text, and output formatting.
- `src/search/session-reader.ts`: JSONL session discovery, filtering, sorting, and JSON pagination metadata.
- `src/tui/*`: interactive picker rendering, key handling, and result selection behavior.

## Interaction Rules

- `codexs <keyword>` searches active sessions from the default recent window and launches the interactive TUI when stdout is a TTY.
- Non-TTY usage must require `--json` or `--jsonl`; do not silently fall back to plain text.
- TUI mode does not accept `--page`, `--offset`, `--limit`/`--page-size`, or `--with-total`.
- `--archived` searches archived sessions only; `--all` searches active plus archived sessions.
- Default time range is `--recent 30d`; `--all-time` is the explicit full-history escape hatch.
- Archived results are read-only in the TUI: do not open Desktop deeplinks or run `codex resume` for them.
- `lucky` opens the newest matching active Desktop thread and does not accept JSON or pagination flags.
- TUI navigation is result-level only. Do not add scrollable detail-pane focus without explicit user approval.
- TUI groups matches by thread, not cwd, and uses a responsive expand/collapse details panel; keep focus on the thread list rather than adding a second scrollable pane.
- TUI must preserve a visible footer in small terminals and redraw on terminal resize events.
- The footer/status bar may show global search and viewport summaries such as `searching`, `scan`, `selected`, `visible`, and `detail`, but it must not show current-thread metadata or per-thread scan state.
- The default TUI action for `Enter` is opening the selected active `codex://threads/<id>` link.
- Default TUI search should show first matching threads quickly, then backfill additional matches instead of waiting for a full scan before rendering.
- Prefer displaying Codex thread titles from `~/.codex/state_5.sqlite`; fall back to thread id when unavailable.

## Verification

- For user-visible CLI behavior changes, run `pnpm verify`.
- For packaging changes, run `npm pack --dry-run`.
- Do not add unit tests that only mirror static configuration, hard-coded option lists, or generated shell-completion text. Prefer behavior tests for parsing, search, output shape, dynamic completion data, and TUI interaction.
