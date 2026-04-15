import { type SearchHit, type SearchResultsPage } from "../search/session-reader.js";

export function formatJsonResults(results: SearchResultsPage): string {
  return `${JSON.stringify(results, null, 2)}\n`;
}

export function formatHumanResults(results: SearchResultsPage): string {
  if (results.hits.length === 0) {
    return `No matches found.\n${formatSummary(results, 0, 0)}\n`;
  }

  const firstShown = results.offset + 1;
  const lastShown = results.offset + results.hits.length;

  return `${results.hits.map((hit, index) => formatHit(hit, results.offset + index)).join("\n\n")}\n\n${formatSummary(results, firstShown, lastShown)}\n`;
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

function formatSummary(results: SearchResultsPage, firstShown: number, lastShown: number): string {
  const summary = [`Showing ${firstShown}-${lastShown}`];
  summary.push(`page ${results.page}`);
  summary.push(`pageSize ${results.pageSize}`);
  summary.push(`offset ${results.offset}`);
  summary.push(`hasMore ${results.hasMore ? "yes" : "no"}`);

  if (results.total !== undefined) {
    summary.push(`total ${results.total}`);
  }

  return summary.join("  ");
}
