import { getUsage, PROGRAM_SUMMARY } from "./spec.js";

export function printHelp(stream: NodeJS.WriteStream): void {
  stream.write(`${PROGRAM_SUMMARY}\n\n`);
  stream.write(`Usage:\n`);
  stream.write(`  ${getUsage()}\n`);
  stream.write(`  ${getUsage("search", "lucky")}\n\n`);
  stream.write(`Options:\n`);
  stream.write(`  --active              Search active sessions only\n`);
  stream.write(`  --archived            Search archived sessions only\n`);
  stream.write(`  --json                Output machine-readable JSON instead of launching the TUI\n`);
  stream.write(`  -n, --limit <N>       JSON mode only. Page size (default: 5)\n`);
  stream.write(`  -p, --page <N>        JSON mode only. 1-based page number\n`);
  stream.write(`  -o, --offset <N>      JSON mode only. 0-based result offset\n`);
  stream.write(`  --with-total          JSON mode only. Include an exact total count\n`);
  stream.write(`  -i, --case-sensitive  Match with exact case\n`);
  stream.write(`  --recent <duration>   Filter to recent sessions, for example 30m, 12h, 7d, 2w\n`);
  stream.write(`  --start <YYYY-MM-DD>  Filter from a local start date\n`);
  stream.write(`  --end <YYYY-MM-DD>    Filter through a local end date\n`);
  stream.write(`  --root-dir <PATH>     Override the Codex home directory root for testing\n`);
  stream.write(`  -h, --help            Show help\n`);
  stream.write(`  -v, --version         Show version\n`);
}
