import {
  COMMAND_FLAGS,
  COMMAND_SPECS,
  GLOBAL_FLAGS,
  PROGRAM_NAME,
  PROGRAM_SUMMARY,
  getCommandSpec,
  getFlagDescription,
  getUsage,
  listFlagAliases,
  listHelpUsageLines,
} from "./spec.js";

function describeFlag(flag: string): string {
  return `${flag}:${getFlagDescription(flag)}`;
}

function listFlagsWithAliases(flags: ReadonlySet<string>): string[] {
  return [
    ...flags,
    ...listFlagAliases()
      .filter(({ flag }) => flags.has(flag))
      .map(({ alias }) => alias),
  ];
}

function listGlobalFlagsWithAliases(): string[] {
  return listFlagsWithAliases(GLOBAL_FLAGS);
}

function listCommandFlagsWithAliases(commandName: keyof typeof COMMAND_FLAGS): string[] {
  return listFlagsWithAliases(COMMAND_FLAGS[commandName] ?? new Set<string>());
}

export function listCompletionDurations(): string[] {
  return ["30m", "1h", "12h", "1d", "3d", "1w", "2w", "30d"];
}

export function listViewModes(): string[] {
  return ["useful", "ops", "protocol", "all"];
}

export function printHelp(stream: NodeJS.WriteStream): void {
  stream.write(`${PROGRAM_SUMMARY}\n\n`);
  printUsage(stream);

  stream.write("\nShared search flags:\n");
  stream.write("  --active | --archived | --all     source scope (default: --active)\n");
  stream.write("  --view <MODE>         useful (default), ops, protocol, or all\n");
  stream.write("  -D, --cwd <PATH>      Filter to threads whose recorded cwd is this path or a subdirectory\n");
  stream.write(`  -i, --case-sensitive  ${getFlagDescription("--case-sensitive")}\n`);

  stream.write("\nTime flags:\n");
  stream.write("  --recent <duration>   Filter to recent thread history, for example 30m, 12h, 7d, 2w (default: 30d)\n");
  stream.write("  --start <YYYY-MM-DD> --end <YYYY-MM-DD>\n");
  stream.write("                          Explicit local date range\n");
  stream.write(`  --all-time            ${getFlagDescription("--all-time")}\n`);

  stream.write("\nJSON flags:\n");
  stream.write("  --json | --jsonl      machine-readable output\n");
  stream.write(`  -n, --limit <N>       ${getFlagDescription("--limit")} (default: 5)\n`);
  stream.write("  -p, --page <N> | -o, --offset <N>\n");
  stream.write("                          JSON pagination\n");
  stream.write(`  --with-total          ${getFlagDescription("--with-total")}\n`);

  stream.write("\nHistory:\n");
  stream.write("  codexs history        list recent explicit searches\n");
  stream.write("  codexs history --json emit machine-readable history output\n");
  stream.write("  codexs history clear  clear stored search history\n");
  stream.write("  codexs history enable enable search history\n");
  stream.write("  codexs history disable disable search history\n");

  stream.write("\nGlobal flags:\n");
  stream.write(`  --root-dir <PATH>     ${getFlagDescription("--root-dir")} for testing\n`);
  stream.write(`  -h, --help            ${getFlagDescription("--help")}\n`);
  stream.write(`  -v, --version         ${getFlagDescription("--version")}\n`);

  stream.write("\nKeyword parsing:\n");
  stream.write("  Use -- before a keyword that starts with -, for example: codexs -- --all\n");

  stream.write("\nNotes:\n");
  stream.write("  On a TTY, bare codexs opens the interactive home screen.\n");
  stream.write("  Non-TTY output requires --json or --jsonl.\n");
  stream.write("  Archived matches are searchable but cannot be reopened directly.\n");
  stream.write("  Unknown commands and close flag typos include a suggestion when available.\n");

  stream.write(`\nCompletion:\n`);
  stream.write(`  ${getUsage("completion")}\n`);
  stream.write(`  ${getUsage("completion", "durations")}\n`);
  stream.write(`  ${getUsage("completion", "cwds")}\n`);
}

export function printUsage(stream: NodeJS.WriteStream): void {
  stream.write("Usage:\n");
  for (const usage of listHelpUsageLines()) {
    stream.write(`  ${usage}\n`);
  }
}

export function buildCompletionZshScript(): string {
  const commands = COMMAND_SPECS
    .filter((command) => command.name !== "search")
    .map((command) => `'${command.name}:${command.name} command'`)
    .join("\n    ");
  const topLevelFlags = [...listGlobalFlagsWithAliases(), ...listCommandFlagsWithAliases("search")]
    .map(describeFlag)
    .map((flag) => `'${flag}'`)
    .join("\n    ");
  const luckyFlags = listCommandFlagsWithAliases("lucky")
    .map(describeFlag)
    .map((flag) => `'${flag}'`)
    .join(" ");
  const completionFlags = listCommandFlagsWithAliases("completion")
    .map(describeFlag)
    .map((flag) => `'${flag}'`)
    .join(" ");
  const completionTargets = getCommandSpec("completion").completionTargets ?? [];

  return `#compdef ${PROGRAM_NAME}

_${PROGRAM_NAME}() {
  local -a commands top_level_flags command_flags durations views
  local command=\${words[2]}
  local current_word=\${words[CURRENT]}
  local previous=\${words[CURRENT-1]}

  commands=(
    ${commands}
  )
  top_level_flags=(
    ${topLevelFlags}
  )

  if [[ "$previous" == "--recent" ]]; then
    durations=(\${(@f)\$(${PROGRAM_NAME} completion --durations 2>/dev/null)})
    if (( \${#durations[@]} > 0 )); then
      _describe -t duration 'duration' durations
      return 0
    fi
  fi

  if [[ "$previous" == "--view" ]]; then
    views=(${listViewModes().map((mode) => `'${mode}'`).join(" ")})
    _describe -t search-view 'search view' views
    return 0
  fi

  if [[ "$previous" == "-D" || "$previous" == "--cwd" ]]; then
    _codexs_recorded_cwds() {
      local -a values
      values=(\${(@f)\$(${PROGRAM_NAME} completion --cwds 2>/dev/null)})
      (( \${#values[@]} == 0 )) && return 1
      _describe -t recorded-cwds 'recorded cwd' values
    }

    _alternative \\
      'recorded-cwds:recorded cwd:_codexs_recorded_cwds' \\
      'directories:directory:_files -/'
    return 0
  fi

  if [[ "$previous" == "--root-dir" ]]; then
    _files -/
    return 0
  fi

  if (( CURRENT == 2 )); then
    _describe -t commands 'command' commands
    _describe -t flags 'search flag' top_level_flags
    return 0
  fi

  if [[ "$command" == "completion" ]]; then
    if [[ "$current_word" == -* ]]; then
      _describe -t completion-flag 'completion flag' \\
        ${completionFlags}
      return 0
    fi

    _describe -t completion-target 'completion target' \\
${completionTargets.map((target) => `      '${target}:${target} completion script' \\`).join("\n")}
      ${completionFlags}
    return 0
  fi

  if [[ "$command" == "history" ]]; then
    if [[ "$current_word" == -* ]]; then
      _describe -t history-flag 'history flag' \\
        ${listCommandFlagsWithAliases("history").map(describeFlag).map((flag) => `'${flag}'`).join(" ")}
      return 0
    fi

    _describe -t history-action 'history action' \\
      'clear:clear stored search history' \\
      'enable:enable search history' \\
      'disable:disable search history'
    return 0
  fi

  command_flags=()
  case "$command" in
    lucky)
      command_flags=(${luckyFlags})
      ;;
    *)
      command_flags=(${topLevelFlags})
      ;;
  esac

  if [[ "$current_word" == -* ]]; then
    _describe -t flags 'flag' command_flags
  fi
}

_${PROGRAM_NAME} "$@"
`;
}

export function buildCompletionBashScript(): string {
  const commands = COMMAND_SPECS
    .filter((command) => command.name !== "search")
    .map((command) => command.name)
    .join(" ");
  const topLevelFlags = [...listGlobalFlagsWithAliases(), ...listCommandFlagsWithAliases("search")].join(" ");
  const luckyFlags = [...listGlobalFlagsWithAliases(), ...listCommandFlagsWithAliases("lucky")].join(" ");
  const completionFlags = [...listGlobalFlagsWithAliases(), ...listCommandFlagsWithAliases("completion")].join(" ");
  const completionTargets = (getCommandSpec("completion").completionTargets ?? []).join(" ");

  return `_${PROGRAM_NAME}() {
  local cur prev command command_flags durations recorded_cwds
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  command="\${COMP_WORDS[1]}"

  if [[ "\${prev}" == "--recent" ]]; then
    durations="$(${PROGRAM_NAME} completion --durations 2>/dev/null)"
    COMPREPLY=( $(compgen -W "\${durations}" -- "\${cur}") )
    return 0
  fi

  if [[ "\${prev}" == "--view" ]]; then
    COMPREPLY=( $(compgen -W "${listViewModes().join(" ")}" -- "\${cur}") )
    return 0
  fi

  if [[ "\${prev}" == "-D" || "\${prev}" == "--cwd" ]]; then
    recorded_cwds="$(${PROGRAM_NAME} completion --cwds 2>/dev/null)"
    COMPREPLY=( $(compgen -W "\${recorded_cwds}" -- "\${cur}") $(compgen -d -- "\${cur}") )
    return 0
  fi

  if [[ "\${prev}" == "--root-dir" ]]; then
    COMPREPLY=( $(compgen -d -- "\${cur}") )
    return 0
  fi

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commands} ${topLevelFlags}" -- "\${cur}") )
    return 0
  fi

  if [[ "\${command}" == "completion" ]]; then
    COMPREPLY=( $(compgen -W "${completionTargets} ${completionFlags}" -- "\${cur}") )
    return 0
  fi

  if [[ "\${command}" == "history" ]]; then
    COMPREPLY=( $(compgen -W "clear enable disable ${[...listGlobalFlagsWithAliases(), ...listCommandFlagsWithAliases("history")].join(" ")}" -- "\${cur}") )
    return 0
  fi

  command_flags="${topLevelFlags}"
  if [[ "\${command}" == "lucky" ]]; then
    command_flags="${luckyFlags}"
  fi

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "\${command_flags}" -- "\${cur}") )
  fi
}

complete -F _${PROGRAM_NAME} ${PROGRAM_NAME}
`;
}
