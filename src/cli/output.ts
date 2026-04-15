import { type SearchHit } from "../search/session-reader.js";

export function formatJsonResults(results: SearchHit[]): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}

export function formatHumanResults(results: SearchHit[]): string {
  if (results.length === 0) {
    return "No matches found.\n";
  }

  return `${results.map(formatHit).join("\n\n")}\n`;
}

function formatHit(hit: SearchHit): string {
  const lines = [
    `[${hit.timestamp}] ${hit.sessionId}`,
    `cwd: ${hit.cwd ?? "-"}`,
    `snippet: ${hit.snippet}`,
    `file: ${hit.filePath}`,
    `resume: ${hit.resumeCommand}`,
    `open: ${hit.deepLink}`,
  ];

  return lines.join("\n");
}
