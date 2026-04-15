import packageJson from "../package.json" with { type: "json" };
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

import { parseArgs, type ParsedArgs } from "./cli/args.js";
import { printHelp } from "./cli/help.js";
import { formatJsonResults } from "./cli/output.js";
import { getUsage } from "./cli/spec.js";
import { type SearchResultsPage, type SearchSource, searchArchivedSessions } from "./search/session-reader.js";
import { runSearchTui } from "./tui/index.js";

interface CliStreams {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

interface RunCliOptions extends Partial<CliStreams> {
  openUrl?: (url: string) => Promise<void>;
  resumeSession?: (sessionId: string) => Promise<number>;
  runTui?: (options: {
    query: string;
    results: SearchResultsPage;
    stdin: NodeJS.ReadStream;
    stdout: NodeJS.WriteStream;
    openHit: (hit: SearchResultsPage["hits"][number]) => Promise<void>;
    resumeHit: (hit: SearchResultsPage["hits"][number]) => Promise<number>;
  }) => Promise<number>;
  isInteractiveTty?: boolean;
  now?: Date;
}

const execFileAsync = promisify(execFile);

export async function runCli(
  argv: string[],
  options: RunCliOptions = {},
): Promise<number> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const openUrl = options.openUrl ?? defaultOpenUrl;
  const resumeSession = options.resumeSession ?? defaultResumeSession;
  const runTui = options.runTui ?? runSearchTui;
  const isInteractiveTty = options.isInteractiveTty ?? Boolean(stdin.isTTY && stdout.isTTY);
  const now = options.now;

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

  if (parsed.mode === "lucky" && (parsed.paginationExplicit || parsed.json)) {
    stderr.write('Lucky mode does not support "--json", "--page", "--page-size", "--offset", "--limit", or "--with-total".\n');
    return 1;
  }

  if (!parsed.json && parsed.paginationExplicit) {
    stderr.write('Interactive mode does not support "--page", "--page-size", "--offset", "--limit", or "--with-total". Use "--json" for standard output.\n');
    return 1;
  }

  if (parsed.mode !== "lucky" && !parsed.json && !isInteractiveTty) {
    stderr.write("Interactive output requires a TTY. Use --json for standard output.\n");
    return 1;
  }

  const searchOptions = {
    query: parsed.query,
    codexHomeDir: parsed.rootDir ?? undefined,
    sources: (parsed.sourceMode === "all" ? ["active", "archived"] : [parsed.sourceMode]) as SearchSource[],
    caseSensitive: parsed.caseSensitive,
    recent: parsed.recent ?? undefined,
    start: parsed.start ?? undefined,
    end: parsed.end ?? undefined,
    now,
  };

  if (parsed.mode === "lucky") {
    const results = await searchArchivedSessions({
      ...searchOptions,
      page: 1,
      pageSize: 1,
    });
    const luckyHit = results.hits[0];
    if (!luckyHit) {
      stderr.write("No matches found.\n");
      return 1;
    }

    await openUrl(luckyHit.deepLink);
    stdout.write(`Opened ${luckyHit.deepLink}\n`);
    return 0;
  }

  if (parsed.json) {
    const results = await searchArchivedSessions({
      ...searchOptions,
      page: parsed.page,
      pageSize: parsed.pageSize,
      offset: parsed.offset ?? undefined,
      withTotal: parsed.withTotal,
    });
    stdout.write(formatJsonResults(results));
    return 0;
  }

  return runTui({
    query: parsed.query,
    results: await searchArchivedSessions({
      ...searchOptions,
      page: 1,
      pageSize: Number.MAX_SAFE_INTEGER,
    }),
    stdin,
    stdout,
    openHit: async (hit) => {
      await openUrl(hit.deepLink);
    },
    resumeHit: async (hit) => resumeSession(hit.sessionId),
  });
}

async function defaultOpenUrl(url: string): Promise<void> {
  await execFileAsync("open", [url]);
}

async function defaultResumeSession(sessionId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["resume", sessionId], {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
  });
}
