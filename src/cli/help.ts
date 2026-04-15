import { getUsage, PROGRAM_SUMMARY } from "./spec.js";

export function printHelp(stream: NodeJS.WriteStream): void {
  stream.write(`${PROGRAM_SUMMARY}\n\n`);
  stream.write(`Usage:\n`);
  stream.write(`  ${getUsage()}\n\n`);
  stream.write(`Options:\n`);
  stream.write(`  --json                Output machine-readable JSON\n`);
  stream.write(`  -n, --limit <N>       Limit returned hits (default: 20)\n`);
  stream.write(`  -i, --case-sensitive  Match with exact case\n`);
  stream.write(`  --root-dir <PATH>     Override archived session directory\n`);
  stream.write(`  -h, --help            Show help\n`);
  stream.write(`  -v, --version         Show version\n`);
}
