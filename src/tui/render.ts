import {
  aggregateSearchHitsBySession,
  type SearchMatchPreview,
  type SearchResultsPage,
  type SearchSessionGroup,
} from "../search/session-reader.js";
import { ANSI } from "./ansi.js";
import {
  computePanelFrame,
  getBodyHeight,
  getDetailMetadataLineCount,
  getPanelContentSize,
  getSideBySidePaneWidths,
  getStackedListHeight,
  TUI_LAYOUT,
  usesWideDetailsLayout,
} from "./layout.js";
import type { PanelFrame } from "./layout.js";
import {
  displayWidth,
  highlightText,
  padAnsi,
  padDisplay,
  sanitizeBlockText,
  sanitizeInlineText,
  stripAnsi,
  truncate,
  truncatePlain,
  wrapBlock,
} from "./text.js";
import type { RenderSearchTuiScreenOptions, TuiState } from "./types.js";
import type { SearchProgress } from "../search/view-filter.js";

interface SessionColumn {
  key: "time" | "source" | "title" | "matches" | "cwd";
  width: number;
  label: string;
  align?: "left" | "right";
  dim?: boolean;
}

interface SessionColumnTemplate {
  key: SessionColumn["key"];
  label: string;
  width?: number;
  minWidth?: number;
  align?: "left" | "right";
  dim?: boolean;
}

type SessionListItem =
  | { type: "bucket"; label: string }
  | { type: "session"; index: number; session: SearchSessionGroup };

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 100;

export { getDetailPanelHeightForLayout, getDetailPreviewPageStep, getPanelContentSize } from "./layout.js";

export function renderSearchTuiScreen(options: RenderSearchTuiScreenOptions): string {
  const sessions = options.sessions ?? aggregateSearchHitsBySession(options.results.hits);
  const frame = computePanelFrame(options.width, options.height);
  const { width: innerWidth, height: innerHeight } = getPanelContentSize(options.width, options.height);
  const bodyHeight = getBodyHeight(innerHeight);
  const clampedState = clampStateForViewport(options.state, sessions, innerWidth, innerHeight);
  const expanded = getExpandedSessionForState(sessions, clampedState);
  const panelLines: string[] = [];
  const nowMs = options.nowMs ?? Date.now();

  panelLines.push(`${ANSI.bold}${ANSI.cyan}codexs${ANSI.reset}  ${ANSI.dim}thread search${ANSI.reset}`);
  panelLines.push(truncate(`keyword: ${options.query}`, innerWidth));
  panelLines.push(divider(innerWidth));

  if (sessions.length === 0) {
    panelLines.push(...fitLines([
      options.searching ? "Searching..." : "No matches found.",
      "",
    ], bodyHeight));
  } else {
    panelLines.push(...renderBodyLines(
      sessions,
      clampedState,
      expanded,
      innerWidth,
      bodyHeight,
      options.query,
      options.caseSensitive ?? false,
      nowMs,
    ));
  }

  panelLines.push(divider(innerWidth));
  panelLines.push(formatStatusLine(sessions, options.results, clampedState, innerWidth, innerHeight, nowMs, {
    searching: options.searching ?? false,
    sourceLabel: options.sourceLabel,
    rangeLabel: options.rangeLabel,
    cwdLabel: options.cwdLabel,
    progress: options.progress ?? null,
    prompt: options.prompt ?? null,
  }));
  panelLines.push(renderHintBar(innerWidth, options.searchHint ?? null, clampedState, Boolean(expanded)));

  return renderPanelScreen(options.width, options.height, frame, fitLines(panelLines, innerHeight));
}

function renderBodyLines(
  sessions: SearchSessionGroup[],
  state: TuiState,
  expanded: SearchSessionGroup | null,
  width: number,
  bodyHeight: number,
  query: string,
  caseSensitive: boolean,
  nowMs: number,
): string[] {
  if (expanded) {
    return usesWideDetailsLayout(width)
      ? renderSideBySideBodyLines(sessions, state, width, bodyHeight, expanded, query, caseSensitive, nowMs)
      : renderStackedBodyLines(sessions, state, width, bodyHeight, expanded, query, caseSensitive, nowMs);
  }

  return renderListOnlyBodyLines(sessions, state, width, bodyHeight, query, caseSensitive, nowMs);
}

function renderListOnlyBodyLines(
  sessions: SearchSessionGroup[],
  state: TuiState,
  width: number,
  bodyHeight: number,
  query: string,
  caseSensitive: boolean,
  nowMs: number,
): string[] {
  const items = collectVisibleSessionListItems(
    sessions,
    state.scrollTop,
    Math.max(0, bodyHeight - 1),
    nowMs,
  );
  const lines: string[] = [
    renderSessionHeader(width),
    ...items.map((item) => (
      item.type === "bucket"
        ? renderSessionBucketRow(item.label, width)
        : renderSessionRow(item.session, item.index === state.selected, width, query, caseSensitive)
    )),
  ];

  return fitLines(lines, bodyHeight);
}

function renderStackedBodyLines(
  sessions: SearchSessionGroup[],
  state: TuiState,
  width: number,
  bodyHeight: number,
  expanded: SearchSessionGroup,
  query: string,
  caseSensitive: boolean,
  nowMs: number,
): string[] {
  const listHeight = getStackedListHeight(bodyHeight, sessions.length);
  const detailHeight = Math.max(0, bodyHeight - listHeight);
  const listLines = renderListOnlyBodyLines(sessions, state, width, listHeight, query, caseSensitive, nowMs);
  const detailLines = renderDetailPanel(expanded, state, width, detailHeight, query, caseSensitive, nowMs);

  return fitLines([...listLines, ...detailLines], bodyHeight);
}

function renderSideBySideBodyLines(
  sessions: SearchSessionGroup[],
  state: TuiState,
  width: number,
  bodyHeight: number,
  expanded: SearchSessionGroup,
  query: string,
  caseSensitive: boolean,
  nowMs: number,
): string[] {
  const { leftWidth, rightWidth } = getSideBySidePaneWidths(width);
  const listLines = renderListOnlyBodyLines(sessions, state, leftWidth, bodyHeight, query, caseSensitive, nowMs);
  const detailLines = renderDetailPanel(expanded, state, rightWidth, bodyHeight, query, caseSensitive, nowMs);
  const lines: string[] = [];

  for (let index = 0; index < bodyHeight; index += 1) {
    const left = listLines[index] ?? "";
    const right = detailLines[index] ?? "";
    lines.push(`${padAnsi(truncate(left, leftWidth), leftWidth)}${ANSI.dim}${TUI_LAYOUT.panelGap}${ANSI.reset}${truncate(right, rightWidth)}`);
  }

  return lines;
}

function renderSessionRow(
  session: SearchSessionGroup,
  selected: boolean,
  width: number,
  query: string,
  caseSensitive: boolean,
): string {
  const columns = getSessionColumns(width);
  const resumeStyle = selected ? ANSI.inverse : "";
  const prefix = selected ? `${ANSI.inverse}›` : " ";
  const row = `${prefix} ${columns.map((column) => (
    formatSessionCell(session, column, query, caseSensitive, resumeStyle)
  )).join("  ")}`;
  return truncate(`${row}${selected ? ANSI.reset : ""}`, width);
}

function formatSessionCell(
  session: SearchSessionGroup,
  column: SessionColumn,
  query: string,
  caseSensitive: boolean,
  resumeStyle: string,
): string {
  const raw = column.key === "time"
    ? formatShortTimestamp(session.timestamp)
    : column.key === "source"
      ? formatSource(session.source, column.width)
      : column.key === "title"
        ? sanitizeInlineText(session.title || session.sessionId)
        : column.key === "matches"
          ? `${session.matchCount}`
          : formatCwd(session.cwd);

  const cell = column.key === "title"
    ? formatHighlightedCell(raw, column.width, query, caseSensitive, resumeStyle)
    : formatCell(raw, column.width, column.align ?? "left");
  return column.dim ? `${ANSI.dim}${cell}${ANSI.reset}${resumeStyle}` : cell;
}

function renderSessionHeader(width: number): string {
  const columns = getSessionColumns(width);
  const text = `  ${columns.map((column) => {
    const label = column.key === "matches" && column.width < 7 ? "M" : column.label;
    const cell = formatCell(label, column.width, column.align ?? "left");
    return column.dim ? `${ANSI.dim}${cell}${ANSI.reset}` : cell;
  }).join("  ")}`;

  return `${ANSI.dim}${truncate(text, width)}${ANSI.reset}`;
}

function renderSessionBucketRow(label: string, width: number): string {
  const bucketLabel = `[${label}]`;
  const plain = `  ${bucketLabel} `;
  const remaining = Math.max(0, width - displayWidth(plain));
  return `${ANSI.dim}${truncate(`${plain}${"─".repeat(remaining)}`, width)}${ANSI.reset}`;
}

function collectVisibleSessionListItems(
  sessions: SearchSessionGroup[],
  startIndex: number,
  maxLines: number,
  nowMs: number,
): SessionListItem[] {
  const items: SessionListItem[] = [];
  let previousBucket: string | null = null;

  for (let index = startIndex; index < sessions.length; index += 1) {
    const session = sessions[index];
    if (!session || items.length >= maxLines) {
      break;
    }

    const bucketLabel = getTimeBucketLabel(session.timestamp, nowMs);
    if (bucketLabel !== previousBucket) {
      if (items.length >= maxLines) {
        break;
      }

      items.push({ type: "bucket", label: bucketLabel });
      previousBucket = bucketLabel;
      if (items.length >= maxLines) {
        break;
      }
    }

    items.push({ type: "session", index, session });
  }

  return items;
}

function renderDetailPanel(
  session: SearchSessionGroup,
  state: TuiState,
  width: number,
  height: number,
  query: string,
  caseSensitive: boolean,
  nowMs: number,
): string[] {
  if (height <= 0) {
    return [];
  }

  const detailLines = renderDetailHeader(session, state, width, height, query, caseSensitive);

  const previewLines = renderTranscriptPreview(
    session.matchPreviews,
    state,
    width,
    Math.max(0, height - detailLines.length),
    query,
    caseSensitive,
    nowMs,
    session.timestamp,
  );
  detailLines.push(...previewLines.lines);

  const hiddenMatches = session.matchPreviews.length - previewLines.renderedCount - previewLines.startIndex;
  if (hiddenMatches > 0 && detailLines.length < height) {
    detailLines.push(truncate(`${ANSI.dim}+${hiddenMatches} more matches${ANSI.reset}`, width));
  }

  return fitLines(detailLines, height);
}

function renderTranscriptPreview(
  previews: SearchMatchPreview[],
  state: TuiState,
  width: number,
  height: number,
  query: string,
  caseSensitive: boolean,
  nowMs: number,
  sessionTimestamp: string,
): { lines: string[]; renderedCount: number; startIndex: number } {
  return buildDetailPreviewWindow(
    previews,
    state,
    width,
    height,
    query,
    caseSensitive,
    nowMs,
    sessionTimestamp,
  );
}

function buildDetailPreviewWindow(
  previews: SearchMatchPreview[],
  state: TuiState,
  width: number,
  height: number,
  query: string,
  caseSensitive: boolean,
  nowMs: number,
  sessionTimestamp: string | null,
): { lines: string[]; renderedCount: number; startIndex: number } {
  const lines: string[] = [];
  let renderedCount = 0;
  const startIndex = Math.min(state.detailScrollTop, Math.max(0, previews.length - 1));

  for (let index = startIndex; index < previews.length; index += 1) {
    const preview = previews[index];
    if (!preview) {
      continue;
    }

    const timestamp = preview.timestamp ? formatDetailTimestamp(preview.timestamp, nowMs, sessionTimestamp) : "--:--";
    const isSelected = state.focus === "detail" && index === state.detailSelected;
    const marker = isSelected ? "›" : " ";
    const headerText = `${marker} ${index + 1}. ${padDisplay(sanitizeInlineText(preview.label), 9)} ${timestamp}`;
    const header = isSelected
      ? `${ANSI.inverse}${colorPreviewLabel(preview.kind, headerText)}${ANSI.reset}`
      : colorPreviewLabel(preview.kind, headerText);

    const contentPrefix = "    ";
    const contentWidth = Math.max(8, width - displayWidth(contentPrefix));
    const bodyLines = wrapBlock(preview.text, contentWidth);
    const secondaryLines = preview.secondaryText
      ? wrapBlock(preview.secondaryText, Math.max(8, width - displayWidth(`${contentPrefix}> `)))
      : [];
    const linesNeeded = 1 + bodyLines.length + secondaryLines.length + (renderedCount > 0 ? 1 : 0);
    if (lines.length > 0 && lines.length + linesNeeded > height) {
      return { lines, renderedCount, startIndex };
    }

    if (lines.length > 0 && lines.length < height) {
      lines.push("");
    }

    if (lines.length >= height) {
      return { lines, renderedCount, startIndex };
    }

    renderedCount += 1;
    lines.push(truncate(header, width));

    for (const part of bodyLines) {
      if (lines.length >= height) {
        return { lines, renderedCount, startIndex };
      }

      lines.push(truncate(`${contentPrefix}${highlightText(part, query, caseSensitive)}`, width));
    }

    for (const part of secondaryLines) {
      if (lines.length >= height) {
        return { lines, renderedCount, startIndex };
      }

      lines.push(truncate(`${contentPrefix}${ANSI.dim}> ${highlightText(part, query, caseSensitive)}${ANSI.reset}`, width));
    }
  }

  return { lines, renderedCount, startIndex };
}

export function measureVisibleDetailPreviewRange(
  previews: SearchMatchPreview[],
  width: number,
  height: number,
  startIndex: number,
): { renderedCount: number; endIndex: number } {
  if (previews.length === 0 || height <= 0) {
    return { renderedCount: 0, endIndex: -1 };
  }

  const result = buildDetailPreviewWindow(
    previews,
    {
      selected: 0,
      scrollTop: 0,
      expandedSessionId: null,
      focus: "detail",
      detailSelected: clamp(startIndex, 0, previews.length - 1),
      detailScrollTop: clamp(startIndex, 0, previews.length - 1),
      statusMessage: null,
    },
    width,
    height,
    "",
    false,
    Date.now(),
    null,
  );
  const endIndex = result.renderedCount === 0 ? startIndex - 1 : startIndex + result.renderedCount - 1;
  return { renderedCount: result.renderedCount, endIndex };
}

function renderDetailHeader(
  session: SearchSessionGroup,
  state: TuiState,
  width: number,
  height: number,
  query: string,
  caseSensitive: boolean,
): string[] {
  const lines: string[] = [];
  const summaryParts = [
    `${ANSI.bold}Details${ANSI.reset}`,
    `${ANSI.dim}${session.matchCount} ${session.matchCount === 1 ? "match" : "matches"}${ANSI.reset}`,
    session.messageCount !== null ? `${ANSI.dim}${session.messageCount} msgs${ANSI.reset}` : null,
    `${ANSI.dim}${session.source}${ANSI.reset}`,
    `${ANSI.dim}detail ${Math.min(state.detailSelected + 1, session.matchPreviews.length)}/${session.matchPreviews.length}${ANSI.reset}`,
    `${ANSI.dim}${formatShortTimestamp(session.timestamp)}${ANSI.reset}`,
  ].filter(Boolean) as string[];
  lines.push(truncate(summaryParts.join("  "), width));

  if (height >= 2) {
    const titlePrefix = `${ANSI.magenta}title:${ANSI.reset} `;
    const titleWidth = Math.max(1, width - displayWidth(stripAnsi(titlePrefix)));
    const title = truncatePlain(sanitizeInlineText(session.title || session.sessionId), titleWidth);
    lines.push(truncate(`${titlePrefix}${highlightText(title, query, caseSensitive)}`, width));
  }

  if (session.cwd && getDetailMetadataLineCount(height, true) >= 3) {
    lines.push(truncate(`${ANSI.magenta}cwd:${ANSI.reset} ${sanitizeInlineText(session.cwd)}`, width));
  }

  return lines;
}

function renderHintBar(
  width: number,
  searchHint: string | null,
  state: TuiState,
  expanded: boolean,
): string {
  if (searchHint) {
    const searchModeHint = [
      formatKey("Enter"), " find",
      "  ", formatKey("Esc"), " cancel",
      "  ", formatKey("Backspace"), " delete",
    ].join("");
    return truncate(searchModeHint, width);
  }

  const compactHint = expanded
    ? state.focus === "detail"
      ? [
        formatKey("Tab"), " list",
        "  ", formatKey("Space"), " close",
        "  ", formatKey("q"), " quit",
      ].join("")
      : [
        formatKey("Enter"), " open",
        "  ", formatKey("Space"), " close",
        "  ", formatKey("Tab"), " detail",
        "  ", formatKey("q"), " quit",
      ].join("")
    : [
      formatKey("Enter"), " open",
      "  ", formatKey("Space"), " detail",
      "  ", formatKey("q"), " quit",
    ].join("");
  const priorityHint = expanded
    ? state.focus === "detail"
      ? [
        formatKey("Tab"), " list",
        "  ", formatKey("Space"), " close",
        "  ", formatKey("/"), " search",
        "  ", formatKey("q"), " quit",
        "  ", formatKey("j/k"), " preview",
      ].join("")
      : [
        formatKey("Enter"), " open",
        "  ", formatKey("o"), " stay",
        "  ", formatKey("r"), " resume",
        "  ", formatKey("Space"), " close",
        "  ", formatKey("Tab"), " detail",
        "  ", formatKey("q"), " quit",
      ].join("")
    : [
      formatKey("Enter"), " open",
      "  ", formatKey("o"), " stay",
      "  ", formatKey("r"), " resume",
      "  ", formatKey("Space"), " detail",
      "  ", formatKey("q"), " quit",
    ].join("");
  const fullHint = expanded
    ? state.focus === "detail"
      ? [
        priorityHint,
        "  ", formatKey("^d/^u"), " page",
        "  ", formatKey("g/G"), " jump",
        "  ", formatKey("n/N"), " next-prev",
      ].join("")
      : [
        priorityHint,
        "  ", formatKey("j/k"), " move",
        "  ", formatKey("^d/^u"), " page",
        "  ", formatKey("/"), " search",
      ].join("")
    : [
      priorityHint,
      "  ", formatKey("j/k"), " move",
      "  ", formatKey("^d/^u"), " page",
      "  ", formatKey("g/G"), " jump",
    ].join("");

  if (displayWidth(stripAnsi(fullHint)) <= width) {
    return fullHint;
  }

  if (displayWidth(stripAnsi(priorityHint)) <= width) {
    return priorityHint;
  }

  return truncate(compactHint, width);
}

function formatKey(label: string): string {
  return `${ANSI.bold}${label}${ANSI.reset}`;
}

function formatStatusLine(
  sessions: SearchSessionGroup[],
  results: SearchResultsPage,
  state: TuiState,
  width: number,
  height: number,
  nowMs: number,
  options: {
    searching: boolean;
    sourceLabel?: string;
    rangeLabel?: string;
    cwdLabel?: string;
    progress: SearchProgress | null;
    prompt: string | null;
  },
): string {
  if (options.prompt) {
    return `${ANSI.cyan}${truncate(options.prompt, width)}${ANSI.reset}`;
  }

  if (state.statusMessage) {
    return `${ANSI.yellow}${truncate(state.statusMessage, width)}${ANSI.reset}`;
  }

  const summary = formatSummary(sessions, results, state, width, height, nowMs, options);
  return `${ANSI.dim}${truncate(summary, width)}${ANSI.reset}`;
}

function formatSummary(
  sessions: SearchSessionGroup[],
  results: SearchResultsPage,
  state: TuiState,
  width: number,
  height: number,
  nowMs: number,
  options: {
    searching: boolean;
    sourceLabel?: string;
    rangeLabel?: string;
    cwdLabel?: string;
    progress: SearchProgress | null;
  },
): string {
  const stateText = options.searching ? `${formatSpinner(nowMs)} Searching...` : "Search complete";
  const selected = sessions.length === 0 ? 0 : Math.min(state.selected + 1, sessions.length);
  const visible = getVisibleRange(sessions, state, width, height);
  const expanded = getExpandedSessionForState(sessions, state);
  const detailSummary = state.focus === "detail" && expanded
    ? `${Math.min(state.detailSelected + 1, expanded.matchPreviews.length)}/${expanded.matchPreviews.length}`
    : null;
  const scanSummary = options.progress && options.progress.totalFiles > 0
    ? `scan ${options.progress.readyFiles}/${options.progress.totalFiles}`
    : null;

  const contextualParts = [
    stateText,
    options.sourceLabel ? `source: ${options.sourceLabel}` : null,
    options.rangeLabel ? `range: ${options.rangeLabel}` : null,
    options.cwdLabel ? `cwd: ${options.cwdLabel}` : null,
    scanSummary,
    `${sessions.length} threads`,
    `${results.hits.length} matches`,
    sessions.length > 0 ? `selected ${selected}/${sessions.length}` : null,
    sessions.length > 0 ? `visible ${visible.start}-${visible.end}` : null,
    detailSummary ? `detail ${detailSummary}` : null,
  ].filter(Boolean) as string[];

  const labeledParts = [
    scanSummary,
    `${sessions.length} threads`,
    `${results.hits.length} matches`,
    sessions.length > 0 ? `selected ${selected}/${sessions.length}` : null,
    sessions.length > 0 ? `visible ${visible.start}-${visible.end}` : null,
    detailSummary ? `detail ${detailSummary}` : null,
  ].filter(Boolean) as string[];

  const compactParts = [
    options.searching ? "searching" : "done",
    scanSummary,
    `${sessions.length} threads`,
    `${results.hits.length} matches`,
    sessions.length > 0 ? `sel ${selected}/${sessions.length}` : null,
    sessions.length > 0 ? `vis ${visible.start}-${visible.end}` : null,
    detailSummary ? `det ${detailSummary}` : null,
  ].filter(Boolean) as string[];

  for (const parts of [contextualParts, labeledParts, compactParts]) {
    const summary = parts.join("  ");
    if (displayWidth(summary) <= width) {
      return summary;
    }
  }

  return compactParts.join("  ");
}

function divider(width: number): string {
  return `${ANSI.dim}${"─".repeat(Math.max(1, width))}${ANSI.reset}`;
}

function getExpandedSessionForState(
  sessions: SearchSessionGroup[],
  state: TuiState,
): SearchSessionGroup | null {
  if (!state.expandedSessionId) {
    return null;
  }

  if (state.focus === "list") {
    return sessions[state.selected]
      ?? sessions.find((session) => session.sessionId === state.expandedSessionId)
      ?? null;
  }

  return sessions.find((session) => session.sessionId === state.expandedSessionId)
    ?? sessions[state.selected]
    ?? null;
}

function formatShortTimestamp(timestamp: string): string {
  return timestamp.slice(5, 16).replace("T", " ");
}

function formatDetailTimestamp(
  timestamp: string,
  _nowMs: number,
  anchorTimestamp: string | null,
): string {
  const anchorDate = anchorTimestamp?.slice(0, 10) ?? null;
  const anchorYear = anchorTimestamp?.slice(0, 4) ?? null;
  const timestampDate = timestamp.slice(0, 10);
  const timestampYear = timestamp.slice(0, 4);
  const time = timestamp.slice(11, 16);

  if (timestampDate === anchorDate) {
    return time;
  }

  if (timestampYear === anchorYear) {
    return `${timestamp.slice(5, 10)} ${time}`;
  }

  return `${timestampDate} ${time}`;
}

function getTimeBucketLabel(timestamp: string, nowMs: number): string {
  const tsMs = Date.parse(timestamp);
  if (!Number.isFinite(tsMs)) {
    return "older";
  }

  const ageMs = Math.max(0, nowMs - tsMs);
  if (ageMs < 86_400_000) {
    return "<1d";
  }

  if (ageMs < (3 * 86_400_000)) {
    return "<3d";
  }

  if (ageMs < (7 * 86_400_000)) {
    return "<1w";
  }

  if (ageMs < (14 * 86_400_000)) {
    return "<2w";
  }

  if (ageMs < (30 * 86_400_000)) {
    return "<1m";
  }

  return "older";
}

function renderPanelScreen(
  width: number,
  height: number,
  frame: PanelFrame,
  panelLines: string[],
): string {
  const screen = Array.from({ length: Math.max(1, height) }, () => "");
  const innerWidth = Math.max(1, frame.width - 2);
  const leftInset = " ".repeat(Math.max(0, frame.x));
  const top = `${leftInset}${ANSI.dim}┌${"─".repeat(innerWidth)}┐${ANSI.reset}`;
  const bottom = `${leftInset}${ANSI.dim}└${"─".repeat(innerWidth)}┘${ANSI.reset}`;

  if (frame.y < screen.length) {
    screen[frame.y] = top;
  }

  for (let index = 0; index < Math.max(0, frame.height - 2); index += 1) {
    const screenRow = frame.y + 1 + index;
    if (screenRow >= screen.length) {
      break;
    }

    const content = panelLines[index] ?? "";
    screen[screenRow] = `${leftInset}${ANSI.dim}│${ANSI.reset}${padAnsi(truncate(content, innerWidth), innerWidth)}${ANSI.dim}│${ANSI.reset}`;
  }

  const bottomRow = frame.y + frame.height - 1;
  if (bottomRow < screen.length) {
    screen[bottomRow] = bottom;
  }

  return screen.join("\n");
}

function getSessionColumns(width: number): SessionColumn[] {
  if (width < 40) {
    return resolveSessionColumns(width, [
      { key: "time", label: "Time", width: 11 },
      { key: "title", label: "Title", minWidth: 8 },
      { key: "matches", label: "Matches", width: 4, align: "right" },
    ]);
  }

  if (width < 56) {
    return resolveSessionColumns(width, [
      { key: "time", label: "Time", width: 11 },
      { key: "cwd", label: "Cwd", width: 10, dim: true },
      { key: "title", label: "Title", minWidth: 8 },
      { key: "matches", label: "Matches", width: 4, align: "right" },
    ]);
  }

  return resolveSessionColumns(width, [
    { key: "time", label: "Time", width: 11 },
    { key: "source", label: "Src", width: 3 },
    { key: "cwd", label: "Cwd", width: 14, dim: true },
    { key: "title", label: "Title", minWidth: 10 },
    { key: "matches", label: "Matches", width: 7, align: "right" },
  ]);
}

function formatSpinner(nowMs: number): string {
  const frameIndex = Math.floor(nowMs / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length;
  return `${ANSI.cyan}${SPINNER_FRAMES[frameIndex]}${ANSI.reset}`;
}

function resolveSessionColumns(width: number, templates: SessionColumnTemplate[]): SessionColumn[] {
  const prefixWidth = 2;
  const gapWidth = Math.max(0, (templates.length - 1) * 2);
  const fixedWidth = templates.reduce((sum, template) => sum + (template.width ?? 0), 0);
  const flexibleColumns = templates.filter((template) => template.width === undefined);
  const availableFlexibleWidth = Math.max(
    1,
    width - prefixWidth - gapWidth - fixedWidth,
  );
  const assignedFlexibleWidth = flexibleColumns.length === 0
    ? 0
    : Math.max(
      flexibleColumns.reduce((sum, template) => sum + (template.minWidth ?? 1), 0),
      availableFlexibleWidth,
    );
  let remainingFlexibleWidth = assignedFlexibleWidth;
  let remainingFlexibleColumns = flexibleColumns.length;

  return templates.map((template) => {
    if (template.width !== undefined) {
      return {
        key: template.key,
        label: template.label,
        width: template.width,
        align: template.align,
        dim: template.dim,
      };
    }

    const minWidth = template.minWidth ?? 1;
    const widthForColumn = remainingFlexibleColumns === 1
      ? remainingFlexibleWidth
      : Math.max(minWidth, remainingFlexibleWidth - ((remainingFlexibleColumns - 1) * minWidth));
    remainingFlexibleWidth -= widthForColumn;
    remainingFlexibleColumns -= 1;

    return {
      key: template.key,
      label: template.label,
      width: widthForColumn,
      align: template.align,
      dim: template.dim,
    };
  });
}

function formatCell(value: string, width: number, align: "left" | "right"): string {
  const trimmed = truncatePlain(sanitizeInlineText(value), width);
  const remaining = Math.max(0, width - displayWidth(trimmed));
  return align === "right"
    ? `${" ".repeat(remaining)}${trimmed}`
    : `${trimmed}${" ".repeat(remaining)}`;
}

function formatHighlightedCell(
  value: string,
  width: number,
  query: string,
  caseSensitive: boolean,
  resumeStyle: string,
): string {
  const truncated = truncatePlain(sanitizeInlineText(value), width);
  const highlighted = highlightText(truncated, query, caseSensitive, resumeStyle);
  const remaining = Math.max(0, width - displayWidth(truncated));
  return `${highlighted}${" ".repeat(remaining)}`;
}

function formatSource(source: SearchSessionGroup["source"], width: number): string {
  if (width < 42) {
    return source === "active" ? "act" : "arc";
  }

  return source === "active" ? "active" : "arch";
}

function colorPreviewLabel(kind: SearchMatchPreview["kind"], value: string): string {
  if (kind === "assistant") {
    return `${ANSI.cyan}${value}${ANSI.reset}`;
  }

  if (kind === "user") {
    return `${ANSI.yellow}${value}${ANSI.reset}`;
  }

  if (kind === "tool" || kind === "command") {
    return `${ANSI.magenta}${value}${ANSI.reset}`;
  }

  return value;
}

function formatCwd(cwd: string | null): string {
  if (!cwd) {
    return "-";
  }

  const parts = sanitizeInlineText(cwd).split("/").filter(Boolean);
  return parts.at(-1) ?? cwd;
}

function fitLines(lines: string[], height: number): string[] {
  const fitted = lines.slice(0, Math.max(0, height));
  while (fitted.length < height) {
    fitted.push("");
  }

  return fitted;
}

export function getVisibleSessionCapacityForLayout(
  sessions: SearchSessionGroup[],
  state: TuiState,
  width: number,
  height: number,
): number {
  if (sessions.length === 0) {
    return 0;
  }

  const bodyHeight = getSessionListBodyHeight(sessions, state, width, height);
  const items = collectVisibleSessionListItems(sessions, state.scrollTop, Math.max(0, bodyHeight - 1), Date.now());
  return items.filter((item) => item.type === "session").length;
}

function getVisibleRange(
  sessions: SearchSessionGroup[],
  state: TuiState,
  width: number,
  height: number,
): { start: number; end: number } {
  if (sessions.length === 0) {
    return { start: 0, end: 0 };
  }

  const bodyHeight = getSessionListBodyHeight(sessions, state, width, height);
  const items = collectVisibleSessionListItems(sessions, state.scrollTop, Math.max(0, bodyHeight - 1), Date.now());
  const visibleIndexes = items
    .filter((item): item is Extract<SessionListItem, { type: "session" }> => item.type === "session")
    .map((item) => item.index);
  const start = visibleIndexes[0] !== undefined ? visibleIndexes[0] + 1 : Math.min(state.scrollTop + 1, sessions.length);
  const end = visibleIndexes.at(-1) !== undefined ? (visibleIndexes.at(-1) ?? 0) + 1 : start;
  return { start, end };
}

export function clampStateForViewport(
  state: TuiState,
  sessions: SearchSessionGroup[],
  width: number,
  height: number,
): TuiState {
  const visibleSessions = Math.max(1, getVisibleSessionCapacityForLayout(sessions, state, width, height));
  const size = sessions.length;
  if (size === 0) {
    return {
      selected: 0,
      scrollTop: 0,
      expandedSessionId: null,
      focus: "list",
      detailSelected: 0,
      detailScrollTop: 0,
      statusMessage: state.statusMessage,
    };
  }

  const selected = clamp(state.selected, 0, size - 1);
  const maxScrollTop = Math.max(0, size - visibleSessions);
  const expanded = sessions.find((session) => session.sessionId === state.expandedSessionId) ?? null;
  const detailCount = expanded?.matchPreviews.length ?? 0;

  return {
    selected,
    scrollTop: clamp(state.scrollTop, 0, maxScrollTop),
    expandedSessionId: expanded?.sessionId ?? null,
    focus: expanded ? state.focus : "list",
    detailSelected: detailCount > 0 ? clamp(state.detailSelected, 0, detailCount - 1) : 0,
    detailScrollTop: detailCount > 0 ? clamp(state.detailScrollTop, 0, detailCount - 1) : 0,
    statusMessage: state.statusMessage,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getSessionListBodyHeight(
  sessions: SearchSessionGroup[],
  state: TuiState,
  width: number,
  height: number,
): number {
  const bodyHeight = getBodyHeight(height);
  const expanded = sessions.some((session) => session.sessionId === state.expandedSessionId);
  if (expanded && !usesWideDetailsLayout(width)) {
    return Math.min(bodyHeight, getStackedListHeight(bodyHeight, sessions.length));
  }

  return bodyHeight;
}
