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

- Bare `codexs` launches the interactive TUI home when stdout is a TTY; `codexs <keyword>` starts the same TUI with an immediate search.
- TUI changes must work for both wide and narrow terminals. Prefer graceful width/height fallbacks over forcing one dense layout everywhere.
- Non-TTY usage must require `--json` or `--jsonl`; do not silently fall back to plain text.
- TUI mode does not accept `--page`, `--offset`, `--limit`/`--page-size`, or `--with-total`.
- TUI global filters are session-local state: source, time range, view, and case mode can change inside the picker and should apply to later searches in the same TUI session.
- `--archived` searches archived sessions only; `--all` searches active plus archived sessions.
- Default time range is `--recent 30d`; `--all-time` is the explicit full-history escape hatch.
- Archived results are read-only in the TUI: do not open Desktop deeplinks or run `codex resume` for them.
- `lucky` opens the newest matching active Desktop thread and does not accept JSON or pagination flags.
- TUI navigation is result-level only. Do not add scrollable detail-pane focus without explicit user approval.
- TUI groups matches by thread, not cwd, and uses a responsive expand/collapse details panel; keep focus on the thread list rather than adding a second scrollable pane.
- TUI must preserve a visible footer in small terminals and redraw on terminal resize events.
- High-attention input, prompts, and temporary pickers belong near the bottom interaction area; if width is tight, split query and context across multiple bottom lines instead of pushing them to the top.
- The footer/status bar may show global search and viewport summaries such as `searching`, `scan`, `selected`, `visible`, and `detail`, but it must not show current-thread metadata or per-thread scan state.
- Current-thread metadata belongs in the detail header, not the footer. Detail headers may show session id, message count, reopenability/read-only state, `resume:` / `open:` actions, and `cwd` when space allows.
- The default TUI action for `Enter` is opening the selected active `codex://threads/<id>` link.
- Default TUI search should show first matching threads quickly, then backfill additional matches instead of waiting for a full scan before rendering.
- Prefer displaying Codex thread titles from `~/.codex/state_5.sqlite`; fall back to thread id when unavailable.

## Verification

- For user-visible CLI behavior changes, run `pnpm verify`.
- For packaging changes, run `npm pack --dry-run`.
- Treat `README.md` and `skills/*` as user-facing onboarding material for coding agents, not runtime requirements.
- If a change affects user-visible commands, flags, output, TUI interaction, or packaging expectations, update `README.md` and any affected agent-skill files in the same change.
- Keep this file focused on repo-stable search and TUI contract; move troubleshooting walkthroughs, comparison notes, and long operational details into `docs/` or `skills/`.
- Do not add unit tests that only mirror static configuration, hard-coded option lists, or generated shell-completion text. Prefer behavior tests for parsing, search, output shape, dynamic completion data, and TUI interaction.
- Automated tests and real self-tests must run against cloned temporary Codex history state. Never point them at the operator's real `~/.codex` sessions, archived sessions, title/state sqlite files, or live Codex TUI processes.
- Prefer copying only the runtime artifacts needed for the scenario into a temp `HOME` or temp codex root, then exercise the real CLI against that clone.
- Verification must cover resource and lifecycle hygiene, not just search correctness. Explicitly watch for idle polling loops and CPU/memory/IO spikes; check graceful quit and forced-interrupt paths; and confirm worker pools, timers, fs handles, temp files, raw-mode/alt-screen state, and cloned runtime directories are released after success, failure, or cancellation.
