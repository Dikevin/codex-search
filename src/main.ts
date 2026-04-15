import packageJson from "../package.json" with { type: "json" };
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseArgs, type ParsedArgs } from "./cli/args.js";
import { printHelp } from "./cli/help.js";
import { formatHumanResults, formatJsonResults } from "./cli/output.js";
import { getUsage } from "./cli/spec.js";
import { type SearchHit, searchArchivedSessions } from "./search/session-reader.js";

interface CliStreams {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

interface RunCliOptions extends Partial<CliStreams> {
  openUrl?: (url: string) => Promise<void>;
}

const execFileAsync = promisify(execFile);

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
  const openUrl = options.openUrl ?? defaultOpenUrl;

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
    stderr.write(`Usage: ${getUsage("search", parsed.mode === "lucky" ? "lucky" : "default")}\n`);
    return 1;
  }

  const results = await searchArchivedSessions({
    query: parsed.query,
    rootDir: parsed.rootDir ?? undefined,
    caseSensitive: parsed.caseSensitive,
    limit: parsed.limit,
  });

  if (parsed.mode === "lucky") {
    const luckyHit = results[0];
    if (!luckyHit) {
      stderr.write("No matches found.\n");
      return 1;
    }

    await openUrl(luckyHit.deepLink);
    stdout.write(`Opened ${luckyHit.deepLink}\n`);
    return 0;
  }

  writeResults(stdout, results, parsed.json);
  return 0;
}

async function defaultOpenUrl(url: string): Promise<void> {
  await execFileAsync("open", [url]);
}
