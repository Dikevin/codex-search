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

- `codexs <keyword>` launches the interactive TUI when stdout is a TTY.
- Non-TTY usage must require `--json`; do not silently fall back to plain text.
- TUI mode does not accept `--page`, `--offset`, `--limit`/`--page-size`, or `--with-total`.
- `lucky` opens the newest matching Desktop thread and does not accept JSON or pagination flags.
- TUI navigation is result-level only. Do not add scrollable detail-pane focus without explicit user approval.
- TUI groups matches by thread and uses inline expand/collapse details; keep focus on the thread list rather than adding a second scrollable pane.
- The default TUI action for `Enter` is opening the selected `codex://threads/<id>` link.

## Verification

- For user-visible CLI behavior changes, run `pnpm verify`.
- For packaging changes, run `npm pack --dry-run`.
