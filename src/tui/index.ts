import readline from "node:readline";

import {
  aggregateSearchHitsBySession,
  type SearchHit,
  type SearchResultsPage,
  type SearchSessionGroup,
} from "../search/session-reader.js";

interface TuiStreams {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

interface TuiActions {
  openHit(hit: SearchHit): Promise<void>;
  resumeHit(hit: SearchHit): Promise<number>;
}

export interface RunSearchTuiOptions extends Partial<TuiStreams>, Partial<TuiActions> {
  query: string;
  results: SearchResultsPage;
}

export interface TuiState {
  selected: number;
  scrollTop: number;
  expandedSessionId: string | null;
}

interface RenderSearchTuiScreenOptions {
  query: string;
  results: SearchResultsPage;
  state: TuiState;
  width: number;
  height: number;
}

const ANSI = {
  clear: "\u001B[2J",
  home: "\u001B[H",
  altOn: "\u001B[?1049h",
  altOff: "\u001B[?1049l",
  hideCursor: "\u001B[?25l",
  showCursor: "\u001B[?25h",
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  cyan: "\u001B[36m",
  magenta: "\u001B[35m",
  yellow: "\u001B[33m",
  inverse: "\u001B[7m",
} as const;

const MAX_EXPANDED_SNIPPETS = 3;

export function createInitialTuiState(): TuiState {
  return {
    selected: 0,
    scrollTop: 0,
    expandedSessionId: null,
  };
}

export function toggleExpandedSelection(
  state: TuiState,
  hits: SearchHit[],
): TuiState {
  const sessions = aggregateSearchHitsBySession(hits);
  const selected = sessions[state.selected];
  if (!selected) {
    return state;
  }

  return {
    ...state,
    expandedSessionId: state.expandedSessionId === selected.sessionId ? null : selected.sessionId,
  };
}

export function renderSearchTuiScreen(options: RenderSearchTuiScreenOptions): string {
  const sessions = aggregateSearchHitsBySession(options.results.hits);
  const width = options.width;
  const bodyHeight = getBodyHeight(options.height);
  const lines: string[] = [];
  const clampedState = clampState(options.state, sessions.length, getVisibleSessionCapacity(options.height));

  lines.push(`${ANSI.bold}${ANSI.cyan}codexs${ANSI.reset}  ${truncate(`query: ${options.query}`, width - 10)}`);
  lines.push(`${ANSI.dim}${formatSummary(sessions, options.results, clampedState)}${ANSI.reset}`);
  lines.push(divider(width));

  if (sessions.length === 0) {
    lines.push("No matches found.");
    lines.push("");
    lines.push(`${ANSI.dim}Press q, Esc, or Enter to exit.${ANSI.reset}`);
    return lines.join("\n");
  }

  lines.push(...renderBodyLines(sessions, clampedState, width, bodyHeight));
  lines.push(divider(width));
  lines.push(renderHintBar(width));

  return lines.join("\n");
}

export async function runSearchTui(options: RunSearchTuiOptions): Promise<number> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const openHit = options.openHit ?? (async () => {});
  const resumeHit = options.resumeHit ?? (async () => 0);
  let state = createInitialTuiState();

  readline.emitKeypressEvents(stdin);
  const previousRawMode = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  writeFrame(stdout, renderSearchTuiScreen({
    query: options.query,
    results: options.results,
    state,
    width: stdout.columns ?? 80,
    height: stdout.rows ?? 24,
  }));

  try {
    while (true) {
      const event = await waitForKeypress(stdin);
      const key = event.key;
      const sessions = aggregateSearchHitsBySession(options.results.hits);

      if (sessions.length === 0) {
        if (key.name === "q" || key.name === "escape" || key.name === "return" || (key.ctrl && key.name === "c")) {
          return 0;
        }
        continue;
      }

      if (key.ctrl && key.name === "c") {
        return 0;
      }

      if (key.name === "escape" || key.name === "q") {
        return 0;
      }

      if (key.name === "return" || key.name === "o") {
        await cleanupTerminal(stdin, stdout, previousRawMode);
        const hit = getSelectedHit(options.results.hits, sessions, state.selected);
        if (hit) {
          await openHit(hit);
        }
        return 0;
      }

      if (key.name === "r") {
        await cleanupTerminal(stdin, stdout, previousRawMode);
        const hit = getSelectedHit(options.results.hits, sessions, state.selected);
        return hit ? resumeHit(hit) : 0;
      }

      if (key.name === "space" || key.name === "l") {
        state = toggleExpandedSelection(state, options.results.hits);
      } else if (key.name === "up" || key.name === "k") {
        state = moveSelection(state, -1, sessions.length, getVisibleSessionCapacity(stdout.rows ?? 24));
      } else if (key.name === "down" || key.name === "j") {
        state = moveSelection(state, 1, sessions.length, getVisibleSessionCapacity(stdout.rows ?? 24));
      } else if (key.name === "pageup") {
        state = moveSelection(state, -getVisibleSessionCapacity(stdout.rows ?? 24), sessions.length, getVisibleSessionCapacity(stdout.rows ?? 24));
      } else if (key.name === "pagedown") {
        state = moveSelection(state, getVisibleSessionCapacity(stdout.rows ?? 24), sessions.length, getVisibleSessionCapacity(stdout.rows ?? 24));
      } else if (key.ctrl && key.name === "u") {
        state = moveSelection(state, -Math.max(1, Math.floor(getVisibleSessionCapacity(stdout.rows ?? 24) / 2)), sessions.length, getVisibleSessionCapacity(stdout.rows ?? 24));
      } else if (key.ctrl && key.name === "d") {
        state = moveSelection(state, Math.max(1, Math.floor(getVisibleSessionCapacity(stdout.rows ?? 24) / 2)), sessions.length, getVisibleSessionCapacity(stdout.rows ?? 24));
      } else if (key.name === "g" && !key.shift) {
        state = moveTo(state, 0, getVisibleSessionCapacity(stdout.rows ?? 24));
      } else if (key.name === "g" && key.shift) {
        state = moveTo(state, sessions.length - 1, getVisibleSessionCapacity(stdout.rows ?? 24));
      } else {
        continue;
      }

      writeFrame(stdout, renderSearchTuiScreen({
        query: options.query,
        results: options.results,
        state,
        width: stdout.columns ?? 80,
        height: stdout.rows ?? 24,
      }));
    }
  } finally {
    await cleanupTerminal(stdin, stdout, previousRawMode);
  }
}

function renderBodyLines(
  sessions: SearchSessionGroup[],
  state: TuiState,
  width: number,
  bodyHeight: number,
): string[] {
  const lines: string[] = [];

  for (let index = state.scrollTop; index < sessions.length; index += 1) {
    const session = sessions[index];
    if (!session) {
      break;
    }

    if (lines.length >= bodyHeight) {
      break;
    }

    lines.push(renderSessionRow(session, index === state.selected, width));

    if (session.sessionId === state.expandedSessionId) {
      const detailLines = renderExpandedDetails(session, width);
      for (const detailLine of detailLines) {
        if (lines.length >= bodyHeight) {
          break;
        }
        lines.push(detailLine);
      }
    }
  }

  while (lines.length < bodyHeight) {
    lines.push("");
  }

  return lines;
}

function renderSessionRow(session: SearchSessionGroup, selected: boolean, width: number): string {
  const prefix = selected ? `${ANSI.inverse}›` : " ";
  const row = `${prefix} ${formatTimestamp(session.timestamp)}  [${session.source}]  ${session.sessionId}  ${session.matchCount} ${session.matchCount === 1 ? "match" : "matches"}  ${session.previewSnippet}`;
  return truncate(`${row}${selected ? ANSI.reset : ""}`, width);
}

function renderExpandedDetails(session: SearchSessionGroup, width: number): string[] {
  const detailLines = [
    truncate(`  ${ANSI.magenta}cwd:${ANSI.reset} ${session.cwd ?? "-"}`, width),
    truncate(`  ${ANSI.magenta}open:${ANSI.reset} ${session.deepLink}`, width),
    truncate(`  ${ANSI.magenta}resume:${ANSI.reset} ${session.resumeCommand}`, width),
  ];

  const snippets = session.snippets.slice(0, MAX_EXPANDED_SNIPPETS);
  snippets.forEach((snippet, index) => {
    detailLines.push(truncate(`  ${index + 1}. ${ANSI.yellow}${snippet}${ANSI.reset}`, width));
  });

  if (session.snippets.length > snippets.length) {
    detailLines.push(truncate(`  ${ANSI.dim}+${session.snippets.length - snippets.length} more matches${ANSI.reset}`, width));
  }

  return detailLines;
}

function renderHintBar(width: number): string {
  const hint = [
    formatKey("Enter"), " open",
    "    ", formatKey("r"), " resume",
    "    ", formatKey("Space"), " details",
    "    ", formatKey("j/k"), " move",
    "    ", formatKey("^d/^u"), " scroll",
    "    ", formatKey("g/G"), " jump",
    "    ", formatKey("q"), " quit",
  ].join("");

  return truncate(hint, width);
}

function formatKey(label: string): string {
  return `${ANSI.bold}${label}${ANSI.reset}`;
}

function formatSummary(sessions: SearchSessionGroup[], results: SearchResultsPage, state: TuiState): string {
  const selected = sessions.length === 0 ? 0 : Math.min(state.selected + 1, sessions.length);
  const parts = [
    `${sessions.length} threads`,
    `${results.hits.length} matches`,
    `selected ${selected}/${sessions.length}`,
  ];

  return parts.join("  ");
}

function divider(width: number): string {
  return `${ANSI.dim}${"─".repeat(Math.max(1, width))}${ANSI.reset}`;
}

function formatTimestamp(timestamp: string): string {
  return timestamp.slice(0, 16).replace("T", " ");
}

function truncate(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  const plain = stripAnsi(value);
  if (plain.length <= width) {
    return value;
  }

  const target = Math.max(1, width - 1);
  return `${plain.slice(0, target)}…`;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");
}

function getBodyHeight(height: number): number {
  return Math.max(5, height - 5);
}

function getVisibleSessionCapacity(height: number): number {
  return Math.max(3, height - 10);
}

function clampState(state: TuiState, size: number, visibleSessions: number): TuiState {
  if (size === 0) {
    return createInitialTuiState();
  }

  const selected = clamp(state.selected, 0, size - 1);
  const maxScrollTop = Math.max(0, size - visibleSessions);

  return {
    selected,
    scrollTop: clamp(state.scrollTop, 0, maxScrollTop),
    expandedSessionId: state.expandedSessionId,
  };
}

function moveSelection(state: TuiState, delta: number, size: number, visibleSessions: number): TuiState {
  if (size === 0) {
    return createInitialTuiState();
  }

  const next = clamp(state.selected + delta, 0, size - 1);
  return moveTo(state, next, visibleSessions);
}

function moveTo(state: TuiState, index: number, visibleSessions: number): TuiState {
  const nextState: TuiState = {
    ...state,
    selected: Math.max(0, index),
  };

  if (nextState.selected < nextState.scrollTop) {
    nextState.scrollTop = nextState.selected;
    return nextState;
  }

  const lastVisible = nextState.scrollTop + visibleSessions - 1;
  if (nextState.selected > lastVisible) {
    nextState.scrollTop = nextState.selected - visibleSessions + 1;
  }

  return nextState;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getSelectedHit(
  hits: SearchHit[],
  sessions: SearchSessionGroup[],
  selectedIndex: number,
): SearchHit | null {
  const sessionId = sessions[selectedIndex]?.sessionId;
  if (!sessionId) {
    return null;
  }

  return hits.find((hit) => hit.sessionId === sessionId) ?? null;
}

async function cleanupTerminal(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  previousRawMode: boolean | undefined,
): Promise<void> {
  stdin.setRawMode?.(Boolean(previousRawMode));
  stdout.write(`${ANSI.reset}${ANSI.showCursor}${ANSI.altOff}`);
}

function writeFrame(stdout: NodeJS.WriteStream, screen: string): void {
  stdout.write(`${ANSI.altOn}${ANSI.hideCursor}${ANSI.clear}${ANSI.home}${screen}`);
}

function waitForKeypress(stdin: NodeJS.ReadStream): Promise<{ key: readline.Key }> {
  return new Promise((resolve) => {
    const onKeypress = (_str: string, key: readline.Key) => {
      stdin.off("keypress", onKeypress);
      resolve({ key });
    };

    stdin.on("keypress", onKeypress);
  });
}
