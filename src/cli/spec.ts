import rawCliSpec from "./spec.json" with { type: "json" };

interface CliFlagSpec {
  flag: string;
  description: string;
  global: boolean;
  aliases?: string[];
}

interface CliCommandSpec {
  name: string;
  flags: string[];
  helpUsages: string[];
  usageErrors: Record<string, string>;
  completionTargets?: string[];
}

interface CliSpec {
  programName: string;
  summary: string;
  flags: CliFlagSpec[];
  commands: CliCommandSpec[];
}

const cliSpec = rawCliSpec as unknown as CliSpec;
const flagDescriptionMap = new Map(
  cliSpec.flags.flatMap((flag) => [
    [flag.flag, flag.description] as const,
    ...(flag.aliases ?? []).map((alias) => [alias, flag.description] as const),
  ]),
);
const flagAliasMap = new Map(
  cliSpec.flags.flatMap((flag) => (flag.aliases ?? []).map((alias) => [alias, flag.flag] as const)),
);

export type { CliCommandSpec, CliFlagSpec };

export const PROGRAM_NAME = cliSpec.programName;
export const PROGRAM_SUMMARY = cliSpec.summary;
export const COMMAND_SPECS = cliSpec.commands;
export const FLAG_SPECS = cliSpec.flags;
export const GLOBAL_FLAGS = new Set(cliSpec.flags.filter((flag) => flag.global).map((flag) => flag.flag));
export const COMMAND_FLAGS = Object.fromEntries(
  cliSpec.commands.map((command) => [command.name, new Set(command.flags)]),
) as Record<(typeof COMMAND_SPECS)[number]["name"], Set<string>>;

export function getFlagDescription(flag: string): string {
  return flagDescriptionMap.get(flag) ?? "option";
}

export function listGlobalFlags(): string[] {
  return cliSpec.flags.filter((flag) => flag.global).map((flag) => flag.flag);
}

export function listFlagAliases(): Array<{ alias: string; flag: string }> {
  return cliSpec.flags
    .flatMap((flag) => (flag.aliases ?? []).map((alias) => ({ alias, flag: flag.flag })))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export function listHelpUsageLines(): string[] {
  const searchUsage = getCommandSpec("search").helpUsages;
  const historyUsage = getCommandSpec("history").helpUsages;

  return [...new Set([...searchUsage, ...historyUsage])];
}

export function getCommandSpec(name: string): CliCommandSpec {
  const command = cliSpec.commands.find((candidate) => candidate.name === name);
  if (!command) {
    throw new Error(`Unknown command spec "${name}".`);
  }

  return command;
}

export function getUsage(commandName = "search", variant = "default"): string {
  const command = getCommandSpec(commandName);
  const usage = command.usageErrors[variant];
  if (!usage) {
    throw new Error(`Unknown usage variant "${variant}" for command "${commandName}".`);
  }

  return usage;
}

export function resolveFlagName(flag: string): string {
  return flagAliasMap.get(flag) ?? flag;
}
