import packageJson from "../package.json" with { type: "json" };

import { parseArgs, type ParsedArgs } from "./cli/args.js";
import { printHelp } from "./cli/help.js";
import { formatHumanResults, formatJsonResults } from "./cli/output.js";
import { getUsage } from "./cli/spec.js";
import { type SearchHit, searchArchivedSessions } from "./search/session-reader.js";

interface CliStreams {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

interface RunCliOptions extends Partial<CliStreams> {}

function writeResults(
  stream: NodeJS.WriteStream,
  results: SearchHit[],
  json: boolean,
): void {
  stream.write(json ? formatJsonResults(results) : formatHumanResults(results));
}

export async function runCli(
  argv: string[],
  options: RunCliOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  if (parsed.version) {
    stdout.write(`${packageJson.version}\n`);
    return 0;
  }

  if (parsed.help) {
    printHelp(stdout);
    return 0;
  }

  if (!parsed.query) {
    stderr.write(`Usage: ${getUsage()}\n`);
    return 1;
  }

  const results = await searchArchivedSessions({
    query: parsed.query,
    rootDir: parsed.rootDir ?? undefined,
    caseSensitive: parsed.caseSensitive,
    limit: parsed.limit,
  });

  writeResults(stdout, results, parsed.json);
  return 0;
}
