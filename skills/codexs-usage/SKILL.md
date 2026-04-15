---
name: codexs-usage
description: Use when a user wants help searching local Codex thread history with the codexs CLI, including the default TUI picker, JSON output, lucky open, active versus archived filtering, recent time windows, date ranges, and jumping back into a matching thread.
---

# codexs Usage

Use this skill when the user wants to find or reopen a local Codex thread with `codexs`. Do not use it for implementing `codex-search` itself.

## How to use

1. Identify whether the user wants the interactive picker, JSON output, the newest matching thread, or a CLI resume command.
2. Prefer the shortest command that satisfies the request.
3. Default to searching all local session sources unless the user explicitly wants only active or only archived sessions.
4. When the user wants to browse results in a terminal, prefer `codexs <keyword>` and explain that it opens a TUI picker by default.
5. When the user needs a thread back in Desktop, prefer `codexs lucky <keyword>` or the returned `open:` deeplink.
6. When the user needs the CLI thread, use the returned `resume:` command.

## Route by task

- Command map: [references/commands.md](references/commands.md)

## Response Guidance

- For broad recall in a terminal, start with `codexs <keyword>`.
- For machine-readable output, include `--json`; mention that non-TTY use requires `--json`.
- Use `-n`, `-p`, `-o`, and `--with-total` only with `--json`.
- For active-only searches, use `--active`. For archived-only searches, use `--archived`.
- For relative time windows, use `--recent <duration>` where duration uses `m`, `h`, `d`, or `w`.
- For explicit date windows, use `--start <YYYY-MM-DD>` and `--end <YYYY-MM-DD>`.
- If the user wants the newest matching Desktop thread immediately, use `codexs lucky <keyword>`.
- If the user asks how to move inside the picker, mention `j/k`, `Up/Down`, `Ctrl+d/u`, `g/G`, `Space`, `Enter`, `r`, and `q`.
- If the user wants raw command help only, answer with commands first and keep explanation short.
