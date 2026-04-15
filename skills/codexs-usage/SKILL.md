---
name: codexs-usage
description: Use when a user wants help searching local Codex thread history with the codexs CLI, including keyword search, lucky open, active versus archived filtering, recent time windows, date ranges, and jumping back into a matching thread.
---

# codexs Usage

Use this skill when the user wants to find or reopen a local Codex thread with `codexs`. Do not use it for implementing `codex-search` itself.

## How to use

1. Identify whether the user wants to search, open the newest match, or resume a thread in CLI.
2. Prefer the shortest command that satisfies the request.
3. Default to searching all local session sources unless the user explicitly wants only active or only archived sessions.
4. When the user needs a thread back in Desktop, prefer `codexs lucky <keyword>` or the returned `open:` deeplink.
5. When the user needs the CLI thread, use the returned `resume:` command.

## Route by task

- Command map: [references/commands.md](references/commands.md)

## Response Guidance

- For broad recall, start with `codexs <keyword>` and add `-n <N>` only when the user wants more or fewer hits.
- For machine-readable output, include `--json`.
- For active-only searches, use `--active`. For archived-only searches, use `--archived`.
- For relative time windows, use `--recent <duration>` where duration uses `m`, `h`, `d`, or `w`.
- For explicit date windows, use `--start <YYYY-MM-DD>` and `--end <YYYY-MM-DD>`.
- If the user wants the newest matching Desktop thread immediately, use `codexs lucky <keyword>`.
- If the user wants raw command help only, answer with commands first and keep explanation short.
