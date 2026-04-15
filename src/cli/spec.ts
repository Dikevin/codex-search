import rawCliSpec from "./spec.json" with { type: "json" };

interface CliCommandSpec {
  name: string;
  helpUsages: string[];
  usageErrors: Record<string, string>;
}

interface CliSpec {
  programName: string;
  summary: string;
  commands: CliCommandSpec[];
}

const cliSpec = rawCliSpec as CliSpec;

export const PROGRAM_NAME = cliSpec.programName;
export const PROGRAM_SUMMARY = cliSpec.summary;
export const COMMAND_SPECS = cliSpec.commands;

export function getUsage(commandName = "search", variant = "default"): string {
  const command = cliSpec.commands.find((candidate) => candidate.name === commandName);
  if (!command) {
    throw new Error(`Unknown command spec "${commandName}".`);
  }

  const usage = command.usageErrors[variant];
  if (!usage) {
    throw new Error(`Unknown usage variant "${variant}" for command "${commandName}".`);
  }

  return usage;
}
