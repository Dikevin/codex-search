import { type SearchHit } from "../search/session-reader.js";

export function formatJsonResults(results: SearchHit[]): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}

export function formatHumanResults(results: SearchHit[]): string {
  if (results.length === 0) {
    return "No matches found.\n";
  }

  return `${results.map((hit, index) => formatHit(hit, index)).join("\n\n")}\n`;
}

function formatHit(hit: SearchHit, index: number): string {
  const lines = [
    `${index + 1}. ${formatTimestamp(hit.timestamp)}  [${hit.source}]  ${hit.sessionId}`,
    `   ${hit.cwd ?? "-"}`,
    `   ${hit.snippet}`,
    `   resume: ${hit.resumeCommand}`,
    `   open:   ${hit.deepLink}`,
  ];

  return lines.join("\n");
}

function formatTimestamp(timestamp: string): string {
  return timestamp.slice(0, 16).replace("T", " ");
}
