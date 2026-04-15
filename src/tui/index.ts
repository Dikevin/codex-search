import readline from "node:readline";

import {
  aggregateSearchHitsBySession,
  aggregateSearchHitsBySessionWithSummaries,
  type SearchHit,
  type SearchResultsPage,
  type SearchSessionGroup,
} from "../search/session-reader.js";
import { ANSI } from "./ansi.js";
import {
  renderSearchTuiScreen,
  measureVisibleDetailPreviewRange,
} from "./render.js";
import {
  getDetailMetadataLineCount,
  getDetailPanelHeightForLayout,
  getDetailPreviewPageStep,
  getPanelContentSize,
  getSideBySidePaneWidths,
  usesWideDetailsLayout,
} from "./layout.js";
import {
  clampStateForViewport,
  getVisibleSessionCapacityForLayout,
} from "./render.js";
import type {
  RunSearchTuiOptions,
  SearchStreamEvent,
  TuiInputEvent,
  TuiState,
} from "./types.js";

const SEARCH_RENDER_INTERVAL_MS = 200;
const ANIMATION_RENDER_INTERVAL_MS = 100;
const SEARCH_EVENTS_PER_YIELD = 25;

interface TuiSearchModel {
  hits: SearchHit[];
  sortedHits: SearchHit[];
  sessions: SearchSessionGroup[];
  searchDone: boolean;
  dirty: boolean;
}

interface DetailSearchState {
  active: boolean;
  query: string;
  lastQuery: string;
}

export { renderSearchTuiScreen } from "./render.js";

export function createInitialTuiState(): TuiState {
  return {
    selected: 0,
    scrollTop: 0,
    expandedSessionId: null,
    focus: "list",
    detailSelected: 0,
    detailScrollTop: 0,
    statusMessage: null,
  };
}

export function toggleExpandedSelection(
  state: TuiState,
  hits: SearchHit[],
): TuiState {
  if (state.expandedSessionId) {
    return {
      ...state,
      expandedSessionId: null,
      focus: "list",
      detailSelected: 0,
      detailScrollTop: 0,
    };
  }

  const sessions = aggregateSearchHitsBySession(hits);
  const selected = sessions[state.selected];
  if (!selected) {
    return state;
  }

  return {
    ...state,
    expandedSessionId: selected.sessionId,
    focus: "detail",
    detailSelected: 0,
    detailScrollTop: 0,
  };
}

export async function runSearchTui(options: RunSearchTuiOptions): Promise<number> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const openHit = options.openHit ?? (async () => {});
  const resumeHit = options.resumeHit ?? (async () => 0);
  const iterator = options.hitStream?.[Symbol.asyncIterator]();
  const model = createTuiSearchModel(options.results?.hits ?? [], !iterator);
  let state = createInitialTuiState();
  let detailSearch: DetailSearchState = {
    active: false,
    query: "",
    lastQuery: "",
  };
  let cleanedUp = false;
  let renderTimer: NodeJS.Timeout | null = null;
  let animationTimer: NodeJS.Timeout | null = null;
  let lastRenderAt = 0;
  let searchEventsSinceYield = 0;

  readline.emitKeypressEvents(stdin);
  const previousRawMode = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdout.write(`${ANSI.altOn}${ANSI.hideCursor}`);

  const getResults = () => materializeTuiResults(model);
  const getSessions = () => materializeTuiSessions(model, options.searchState?.sessionSummaries);
  const render = () => {
    lastRenderAt = Date.now();
    writeFrame(stdout, renderSearchTuiScreen({
      query: options.query,
      results: getResults(),
      sessions: getSessions(),
      state,
      width: stdout.columns ?? 80,
      height: stdout.rows ?? 24,
      caseSensitive: options.caseSensitive,
      searching: !model.searchDone,
      sourceLabel: options.sourceLabel,
      rangeLabel: options.rangeLabel,
      cwdLabel: options.cwdLabel,
      progress: options.searchState?.progress ?? null,
      prompt: detailSearch.active ? `/${detailSearch.query}` : null,
      searchHint: detailSearch.active ? "detail-search" : null,
    }));
  };
  const clearScheduledRender = () => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
  };
  const clearAnimationRender = () => {
    if (animationTimer) {
      clearTimeout(animationTimer);
      animationTimer = null;
    }
  };
  const scheduleSearchRender = () => {
    if (cleanedUp) {
      return;
    }

    const elapsed = Date.now() - lastRenderAt;
    if (elapsed >= SEARCH_RENDER_INTERVAL_MS) {
      clearScheduledRender();
      render();
      return;
    }

    if (!renderTimer) {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        if (!cleanedUp) {
          render();
        }
      }, SEARCH_RENDER_INTERVAL_MS - elapsed);
      renderTimer.unref?.();
    }
  };
  const scheduleAnimationRender = () => {
    if (cleanedUp || model.searchDone || animationTimer) {
      return;
    }

    animationTimer = setTimeout(() => {
      animationTimer = null;
      if (cleanedUp || model.searchDone) {
        return;
      }

      clearScheduledRender();
      render();
      scheduleAnimationRender();
    }, ANIMATION_RENDER_INTERVAL_MS);
    animationTimer.unref?.();
  };
  const finish = async () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    clearScheduledRender();
    clearAnimationRender();
    options.cancelSearch?.();
    await iterator?.return?.();
    await cleanupTerminal(stdin, stdout, previousRawMode);
  };

  let pendingInput = waitForTuiEvent(stdin, stdout).then((event) => ({
    type: "input" as const,
    event,
  }));
  let pendingSearch = nextSearchEvent(iterator);
  const armInput = () => {
    pendingInput = waitForTuiEvent(stdin, stdout).then((event) => ({
      type: "input" as const,
      event,
    }));
  };

  if (options.searchState) {
    options.searchState.notify = () => {
      model.dirty = true;
      scheduleSearchRender();
    };
  }

  render();
  scheduleAnimationRender();

  try {
    while (true) {
      const event = await Promise.race([
        pendingInput,
        ...(pendingSearch ? [pendingSearch] : []),
      ]);

      if (event.type === "search") {
        pendingSearch = null;
        if (event.result.done) {
          model.searchDone = true;
        } else {
          appendTuiSearchHit(model, event.result.value);
          pendingSearch = nextSearchEvent(iterator);
        }

        if (model.searchDone) {
          clearAnimationRender();
          clearScheduledRender();
          render();
        } else {
          scheduleSearchRender();
          scheduleAnimationRender();
        }

        searchEventsSinceYield += 1;
        if (searchEventsSinceYield >= SEARCH_EVENTS_PER_YIELD) {
          searchEventsSinceYield = 0;
          await new Promise((resolve) => setImmediate(resolve));
        }
        continue;
      }

      const inputEvent = event.event;
      const results = getResults();
      const sessions = getSessions();
      const viewport = getPanelContentSize(stdout.columns ?? 80, stdout.rows ?? 24);
      const visibleSessions = getVisibleSessionCapacityForLayout(sessions, state, viewport.width, viewport.height);

      if (inputEvent.type === "resize") {
        state = clampStateForViewport(state, sessions, viewport.width, viewport.height);
        state = syncDetailScroll(state, getExpandedSession(sessions, state), viewport.width, viewport.height);
        armInput();
        clearScheduledRender();
        render();
        continue;
      }

      const key = inputEvent.key;
      const expanded = getExpandedSession(sessions, state);

      if (detailSearch.active) {
        if (key.ctrl && key.name === "c") {
          return 0;
        }

        if (key.name === "escape") {
          detailSearch = { ...detailSearch, active: false, query: "" };
          state = clearStatus(state);
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "backspace" || key.name === "delete") {
          detailSearch = {
            ...detailSearch,
            query: detailSearch.query.slice(0, -1),
          };
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "return") {
          detailSearch = { ...detailSearch, active: false };
          if (!expanded || detailSearch.query.trim() === "") {
            detailSearch = { ...detailSearch, query: "" };
            state = clearStatus(state);
          } else {
            const query = detailSearch.query.trim();
            const matchIndex = findMatchingPreviewIndex(
              expanded.matchPreviews,
              query,
              options.caseSensitive ?? false,
              state.detailSelected,
              1,
              true,
            );
            if (matchIndex === -1) {
              state = withStatus(state, `No detail matches for "${query}".`);
            } else {
              detailSearch = {
                active: false,
                query: "",
                lastQuery: query,
              };
              state = clearStatus({
                ...state,
                focus: "detail",
                detailSelected: matchIndex,
                detailScrollTop: matchIndex,
              });
              state = syncDetailScroll(state, expanded, viewport.width, viewport.height);
            }
          }

          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (isPrintableInput(inputEvent.text, key)) {
          detailSearch = {
            ...detailSearch,
            query: `${detailSearch.query}${inputEvent.text}`,
          };
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        armInput();
        continue;
      }

      if (sessions.length === 0) {
        if (key.name === "q" || key.name === "escape" || key.name === "return" || (key.ctrl && key.name === "c")) {
          return 0;
        }
        armInput();
        continue;
      }

      if (key.ctrl && key.name === "c") {
        return 0;
      }

      if (key.name === "escape" || key.name === "q") {
        return 0;
      }

      if (key.name === "return" || key.name === "o") {
        const hit = getSelectedHit(results.hits, sessions, state.selected);
        if (hit?.source === "archived") {
          state = withStatus(state, archivedUnavailableMessage(hit));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "return") {
          await finish();
          if (hit) {
            await openHit(hit);
          }
          return 0;
        }

        if (hit) {
          await openHit(hit);
        }

        armInput();
        clearScheduledRender();
        render();
        continue;
      }

      if (key.name === "r") {
        const hit = getSelectedHit(results.hits, sessions, state.selected);
        if (hit?.source === "archived") {
          state = withStatus(state, archivedUnavailableMessage(hit));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        await finish();
        return hit ? resumeHit(hit) : 0;
      }

      if (inputEvent.text === "/") {
        const nextState = expanded
          ? state.focus === "detail"
            ? state
            : clearStatus({
              ...state,
              expandedSessionId: sessions[state.selected]?.sessionId ?? state.expandedSessionId,
              focus: "detail",
              detailSelected: 0,
              detailScrollTop: 0,
            })
          : clearStatus(toggleExpandedSelection(state, results.hits));
        const nextExpanded = getExpandedSession(sessions, nextState);

        if (!nextExpanded) {
          armInput();
          continue;
        }

        state = clearStatus({
          ...nextState,
          expandedSessionId: nextExpanded.sessionId,
          focus: "detail",
        });
        state = syncDetailScroll(state, nextExpanded, viewport.width, viewport.height);
        detailSearch = {
          ...detailSearch,
          active: true,
          query: "",
        };
        armInput();
        clearScheduledRender();
        render();
        continue;
      }

      if ((key.name === "n") && expanded && detailSearch.lastQuery) {
        const matchIndex = findMatchingPreviewIndex(
          expanded.matchPreviews,
          detailSearch.lastQuery,
          options.caseSensitive ?? false,
          state.detailSelected,
          key.shift ? -1 : 1,
          false,
        );
        if (matchIndex === -1) {
          state = withStatus(state, `No further detail matches for "${detailSearch.lastQuery}".`);
        } else {
          state = clearStatus({
            ...state,
            focus: "detail",
            detailSelected: matchIndex,
            detailScrollTop: matchIndex,
          });
          state = syncDetailScroll(state, expanded, viewport.width, viewport.height);
        }
        armInput();
        clearScheduledRender();
        render();
        continue;
      }

      const detailPanelHeight = getDetailPanelHeightForLayout(
        sessions,
        state,
        viewport.width,
        viewport.height,
      );
      const detailPageStep = getDetailPreviewPageStep(detailPanelHeight, Boolean(expanded?.cwd));
      if (key.name === "space") {
        state = clearStatus(toggleExpandedSelection(state, results.hits));
        state = clampStateForViewport(state, sessions, viewport.width, viewport.height);
      } else if ((key.name === "right" || key.name === "l") && expanded && state.focus === "list") {
        state = clearStatus({
          ...state,
          expandedSessionId: sessions[state.selected]?.sessionId ?? expanded.sessionId,
          focus: "detail",
        });
      } else if (((key.name === "left" || key.name === "h") && expanded && state.focus === "detail")) {
        state = clearStatus({
          ...state,
          focus: "list",
        });
      } else if (key.name === "tab" && expanded) {
        state = clearStatus({
          ...state,
          expandedSessionId: state.focus === "list"
            ? (sessions[state.selected]?.sessionId ?? expanded.sessionId)
            : expanded.sessionId,
          focus: state.focus === "detail" ? "list" : "detail",
          detailSelected: state.focus === "detail" ? state.detailSelected : 0,
          detailScrollTop: state.focus === "detail" ? state.detailScrollTop : 0,
        });
      } else if ((key.name === "up" || key.name === "k") && state.focus === "detail" && expanded) {
        state = clearStatus({
          ...state,
          detailSelected: clamp(state.detailSelected - 1, 0, Math.max(0, expanded.matchPreviews.length - 1)),
        });
      } else if ((key.name === "down" || key.name === "j") && state.focus === "detail" && expanded) {
        state = clearStatus({
          ...state,
          detailSelected: clamp(state.detailSelected + 1, 0, Math.max(0, expanded.matchPreviews.length - 1)),
        });
      } else if (key.name === "pageup" && state.focus === "detail" && expanded) {
        state = clearStatus({
          ...state,
          detailSelected: clamp(state.detailSelected - detailPageStep, 0, Math.max(0, expanded.matchPreviews.length - 1)),
        });
      } else if (key.name === "pagedown" && state.focus === "detail" && expanded) {
        state = clearStatus({
          ...state,
          detailSelected: clamp(state.detailSelected + detailPageStep, 0, Math.max(0, expanded.matchPreviews.length - 1)),
        });
      } else if (key.ctrl && key.name === "u" && state.focus === "detail" && expanded) {
        state = clearStatus({
          ...state,
          detailSelected: clamp(state.detailSelected - Math.max(1, Math.floor(detailPageStep / 2)), 0, Math.max(0, expanded.matchPreviews.length - 1)),
        });
      } else if (key.ctrl && key.name === "d" && state.focus === "detail" && expanded) {
        state = clearStatus({
          ...state,
          detailSelected: clamp(state.detailSelected + Math.max(1, Math.floor(detailPageStep / 2)), 0, Math.max(0, expanded.matchPreviews.length - 1)),
        });
      } else if (key.name === "g" && !key.shift && state.focus === "detail" && expanded) {
        state = clearStatus({
          ...state,
          detailSelected: 0,
          detailScrollTop: 0,
        });
      } else if (key.name === "g" && key.shift && state.focus === "detail" && expanded) {
        state = clearStatus({
          ...state,
          detailSelected: Math.max(0, expanded.matchPreviews.length - 1),
          detailScrollTop: Math.max(0, expanded.matchPreviews.length - 1),
        });
      } else if (key.name === "up" || key.name === "k") {
        state = clearStatus(syncExpandedSelection(
          moveSelection(state, -1, sessions.length, visibleSessions),
          sessions,
        ));
      } else if (key.name === "down" || key.name === "j") {
        state = clearStatus(syncExpandedSelection(
          moveSelection(state, 1, sessions.length, visibleSessions),
          sessions,
        ));
      } else if (key.name === "pageup") {
        state = clearStatus(syncExpandedSelection(
          moveSelection(state, -visibleSessions, sessions.length, visibleSessions),
          sessions,
        ));
      } else if (key.name === "pagedown") {
        state = clearStatus(syncExpandedSelection(
          moveSelection(state, visibleSessions, sessions.length, visibleSessions),
          sessions,
        ));
      } else if (key.ctrl && key.name === "u") {
        state = clearStatus(syncExpandedSelection(
          moveSelection(state, -Math.max(1, Math.floor(visibleSessions / 2)), sessions.length, visibleSessions),
          sessions,
        ));
      } else if (key.ctrl && key.name === "d") {
        state = clearStatus(syncExpandedSelection(
          moveSelection(state, Math.max(1, Math.floor(visibleSessions / 2)), sessions.length, visibleSessions),
          sessions,
        ));
      } else if (key.name === "g" && !key.shift) {
        state = clearStatus(syncExpandedSelection(
          moveTo(state, 0, visibleSessions),
          sessions,
        ));
      } else if (key.name === "g" && key.shift) {
        state = clearStatus(syncExpandedSelection(
          moveTo(state, sessions.length - 1, visibleSessions),
          sessions,
        ));
      } else {
        armInput();
        continue;
      }

      state = syncDetailScroll(state, getExpandedSession(sessions, state), viewport.width, viewport.height);
      armInput();
      clearScheduledRender();
      render();
    }
  } finally {
    if (options.searchState) {
      options.searchState.notify = undefined;
    }
    await finish();
  }
}

function clearStatus(state: TuiState): TuiState {
  return {
    ...state,
    statusMessage: null,
  };
}

function withStatus(state: TuiState, statusMessage: string): TuiState {
  return {
    ...state,
    statusMessage,
  };
}

function archivedUnavailableMessage(hit: SearchHit): string {
  return `Archived thread cannot be reopened directly: ${hit.sessionId}. Use --active to search reopenable threads.`;
}

function createTuiSearchModel(initialHits: SearchHit[], searchDone: boolean): TuiSearchModel {
  return {
    hits: [...initialHits],
    sortedHits: [],
    sessions: [],
    searchDone,
    dirty: true,
  };
}

function appendTuiSearchHit(model: TuiSearchModel, hit: SearchHit): void {
  model.hits.push(hit);
  model.dirty = true;
}

function materializeTuiResults(model: TuiSearchModel): SearchResultsPage {
  ensureTuiSearchModel(model);
  return {
    hits: model.sortedHits,
    page: 1,
    pageSize: Math.max(5, model.sortedHits.length),
    offset: 0,
    hasMore: !model.searchDone,
  };
}

function materializeTuiSessions(
  model: TuiSearchModel,
  sessionSummaries?: ReadonlyMap<string, { sessionId: string; messageCount: number }>,
): SearchSessionGroup[] {
  ensureTuiSearchModel(model, sessionSummaries);
  return model.sessions;
}

function ensureTuiSearchModel(
  model: TuiSearchModel,
  sessionSummaries?: ReadonlyMap<string, { sessionId: string; messageCount: number }>,
): void {
  if (!model.dirty) {
    return;
  }

  model.sortedHits = [...model.hits].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  model.sessions = aggregateSearchHitsBySessionWithSummaries(model.sortedHits, sessionSummaries);
  model.dirty = false;
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
    focus: "list",
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

function getExpandedSession(
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

function syncExpandedSelection(
  state: TuiState,
  sessions: SearchSessionGroup[],
): TuiState {
  if (!state.expandedSessionId || state.focus !== "list") {
    return state;
  }

  const selectedSession = sessions[state.selected];
  if (!selectedSession) {
    return state;
  }

  return {
    ...state,
    detailSelected: 0,
    detailScrollTop: 0,
  };
}

function syncDetailScroll(
  state: TuiState,
  expanded: SearchSessionGroup | null,
  width: number,
  height: number,
): TuiState {
  if (!expanded) {
    return {
      ...state,
      detailScrollTop: 0,
    };
  }

  const detailWidth = usesWideDetailsLayout(width)
    ? getSideBySidePaneWidths(width).rightWidth
    : width;
  const detailHeight = getDetailPanelHeightForLayout([expanded], {
    ...state,
    expandedSessionId: expanded.sessionId,
  }, width, height);
  const previewHeight = Math.max(0, detailHeight - getDetailMetadataLineCount(detailHeight, Boolean(expanded.cwd)));
  const maxIndex = Math.max(0, expanded.matchPreviews.length - 1);
  const selected = clamp(state.detailSelected, 0, maxIndex);
  let scrollTop = clamp(state.detailScrollTop, 0, maxIndex);

  if (selected < scrollTop) {
    scrollTop = selected;
  }

  while (scrollTop < selected) {
    const range = measureVisibleDetailPreviewRange(expanded.matchPreviews, detailWidth, previewHeight, scrollTop);
    if (selected <= range.endIndex) {
      break;
    }
    scrollTop += 1;
  }

  return {
    ...state,
    detailSelected: selected,
    detailScrollTop: scrollTop,
  };
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

function findMatchingPreviewIndex(
  previews: SearchSessionGroup["matchPreviews"],
  query: string,
  caseSensitive: boolean,
  currentIndex: number,
  direction: 1 | -1,
  includeCurrent: boolean,
): number {
  if (!query || previews.length === 0) {
    return -1;
  }

  let index = includeCurrent
    ? clamp(currentIndex, 0, previews.length - 1)
    : wrapIndex(currentIndex + direction, previews.length);

  for (let scanned = 0; scanned < previews.length; scanned += 1) {
    const preview = previews[index];
    if (preview && previewMatchesQuery(preview, query, caseSensitive)) {
      return index;
    }

    index = wrapIndex(index + direction, previews.length);
  }

  return -1;
}

function previewMatchesQuery(
  preview: SearchSessionGroup["matchPreviews"][number],
  query: string,
  caseSensitive: boolean,
): boolean {
  const haystack = [
    preview.label,
    preview.text,
    preview.secondaryText ?? "",
  ].join("\n");
  const normalizedHaystack = caseSensitive ? haystack : haystack.toLowerCase();
  const normalizedQuery = caseSensitive ? query : query.toLowerCase();
  return normalizedHaystack.includes(normalizedQuery);
}

function wrapIndex(value: number, size: number): number {
  if (size === 0) {
    return 0;
  }

  return ((value % size) + size) % size;
}

function isPrintableInput(text: string, key: readline.Key): boolean {
  return Boolean(
    text
    && text.length === 1
    && text >= " "
    && !key.ctrl
    && !key.meta,
  );
}

async function cleanupTerminal(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  previousRawMode: boolean | undefined,
): Promise<void> {
  stdin.setRawMode?.(Boolean(previousRawMode));
  stdin.pause();
  stdout.write(`${ANSI.reset}${ANSI.showCursor}${ANSI.altOff}`);
}

function writeFrame(stdout: NodeJS.WriteStream, screen: string): void {
  stdout.write(`${ANSI.clear}${ANSI.home}${screen}`);
}

function nextSearchEvent(iterator: AsyncIterator<SearchHit> | undefined): Promise<SearchStreamEvent> | null {
  if (!iterator) {
    return null;
  }

  return iterator.next().then((result) => ({
    type: "search" as const,
    result,
  }));
}

function waitForTuiEvent(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
): Promise<TuiInputEvent> {
  return new Promise((resolve) => {
    const onKeypress = (text: string, key: readline.Key) => {
      cleanup();
      resolve({ type: "key", key, text });
    };
    const onResize = () => {
      cleanup();
      resolve({ type: "resize" });
    };
    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdout.off("resize", onResize);
    };

    stdin.on("keypress", onKeypress);
    stdout.on("resize", onResize);
  });
}
