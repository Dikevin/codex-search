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
  getPanelContentSize,
  getSideBySidePaneWidths,
  usesWideDetailsLayout,
} from "./layout.js";
import {
  clampStateForViewport,
  getVisibleSessionCapacityForLayout,
} from "./render.js";
import {
  createDefaultTuiFilters,
  applyTuiFilterValue,
  formatCompactFilterSummary,
  getTuiFilterValueOptions,
  getTuiFilterRows,
  sameTuiFilters,
  type TuiSearchFilters,
} from "./search-filters.js";
import type {
  RunSearchTuiOptions,
  TuiInputEvent,
  TuiSearchAssistItem,
  TuiSearchAssistState,
  TuiSearchSession,
  TuiState,
} from "./types.js";
import type { SearchProgress } from "../search/view-filter.js";

const SEARCH_RENDER_INTERVAL_MS = 200;
const ANIMATION_RENDER_INTERVAL_MS = 100;
const PREVIEW_DEBOUNCE_MS = 200;
const WIDE_PREVIEW_LIMIT = 5;
const NARROW_PREVIEW_LIMIT = 3;
const WIDE_SUGGESTION_LIMIT = 3;
const NARROW_SUGGESTION_LIMIT = 2;
const EXIT_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

interface TuiSearchModel {
  hits: SearchHit[];
  seedSessions: SearchSessionGroup[];
  sortedHits: SearchHit[];
  sessions: SearchSessionGroup[];
  searchDone: boolean;
  dirty: boolean;
}

interface DetailSearchState {
  active: boolean;
  query: string;
  cursor: number;
  lastQuery: string;
}

interface GlobalSearchState {
  active: boolean;
  home: boolean;
  query: string;
  cursor: number;
}

interface FilterPickerState {
  active: boolean;
  selected: number;
  mode: "rows" | "values";
  draftFilters: TuiSearchFilters;
  valueOptions: string[];
  valueSelected: number;
}

interface ActiveSearchSession {
  query: string;
  caseSensitive: boolean;
  results?: SearchResultsPage;
  seedSessions?: SearchSessionGroup[];
  iterator?: AsyncIterator<SearchHit>;
  cancelSearch?: () => void;
  sourceLabel?: string;
  rangeLabel?: string;
  cwdLabel?: string;
  searchState?: {
    progress?: SearchProgress | null;
    sessionSummaries?: Map<string, { sessionId: string; messageCount: number }>;
    notify?: () => void;
  };
}

interface SearchEventEnvelope {
  type: "search";
  generation: number;
  result: IteratorResult<SearchHit>;
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
  return toggleExpandedSelectionForSessions(
    state,
    aggregateSearchHitsBySession(hits),
  );
}

function toggleExpandedSelectionForSessions(
  state: TuiState,
  sessions: SearchSessionGroup[],
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
  let filters = options.initialFilters ?? createDefaultTuiFilters();
  let currentSearch = createActiveSearchSession(options);
  let currentQuery = currentSearch.query;
  let currentCaseSensitive = currentSearch.caseSensitive;
  let currentCwdLabel = currentSearch.cwdLabel;
  let searchGeneration = 0;
  let model = createTuiSearchModel(
    currentSearch.results?.hits ?? [],
    !currentSearch.iterator,
    currentSearch.seedSessions ?? [],
  );
  let state = createInitialTuiState();
  let detailSearch: DetailSearchState = {
    active: false,
    query: "",
    cursor: 0,
    lastQuery: "",
  };
  let globalSearch: GlobalSearchState = {
    active: currentQuery.trim() === "",
    home: currentQuery.trim() === "",
    query: currentQuery,
    cursor: currentQuery.length,
  };
  let filterPicker: FilterPickerState = {
    active: false,
    selected: 0,
    mode: "rows",
    draftFilters: filters,
    valueOptions: [],
    valueSelected: 0,
  };
  let searchAssist = createSearchAssistState(options.historyEnabled ?? true);
  let cleanedUp = false;
  let renderTimer: NodeJS.Timeout | null = null;
  let animationTimer: NodeJS.Timeout | null = null;
  let lastRenderAt = 0;
  let suggestionGeneration = 0;
  let previewGeneration = 0;
  let previewDebounceTimer: NodeJS.Timeout | null = null;
  let previewAbortController: AbortController | null = null;

  readline.emitKeypressEvents(stdin);
  const previousRawMode = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdout.write(`${ANSI.altOn}${ANSI.hideCursor}`);

  const getResults = () => materializeTuiResults(model);
  const getSessions = () => materializeTuiSessions(model, currentSearch.searchState?.sessionSummaries);
  const getFiltersSummary = (activeFilters = filters) => formatCompactFilterSummary(activeFilters, currentCwdLabel);
  const getPreviewLimit = () => ((stdout.columns ?? 80) >= 88 ? WIDE_PREVIEW_LIMIT : NARROW_PREVIEW_LIMIT);
  const getSuggestionLimit = () => ((stdout.columns ?? 80) >= 88 ? WIDE_SUGGESTION_LIMIT : NARROW_SUGGESTION_LIMIT);
  const cancelPreviewSearch = () => {
    if (previewDebounceTimer) {
      clearTimeout(previewDebounceTimer);
      previewDebounceTimer = null;
    }

    previewAbortController?.abort();
    previewAbortController = null;
  };
  const syncSearchAssistSelection = () => {
    searchAssist = clampSearchAssistSelection(searchAssist);
  };
  const refreshSearchAssist = () => {
    const historyEnabled = options.historyEnabled ?? true;
    if (!globalSearch.active) {
      cancelPreviewSearch();
      searchAssist = {
        ...createSearchAssistState(historyEnabled),
        active: false,
      };
      return;
    }

    const query = globalSearch.query;
    searchAssist = {
      ...searchAssist,
      active: true,
      historyEnabled,
    };

    if (options.onLoadSuggestions) {
      const activeSuggestionGeneration = ++suggestionGeneration;
      void options.onLoadSuggestions({
        query,
        limit: getSuggestionLimit(),
      }).then((result) => {
        if (
          cleanedUp
          || !globalSearch.active
          || activeSuggestionGeneration !== suggestionGeneration
          || globalSearch.query !== query
        ) {
          return;
        }

        searchAssist = {
          ...searchAssist,
          recent: historyEnabled ? result.recent : [],
          projects: result.projects,
        };
        syncSearchAssistSelection();
        scheduleSearchRender();
      }).catch(() => {});
    } else {
      searchAssist = {
        ...searchAssist,
        recent: [],
        projects: [],
      };
    }

    cancelPreviewSearch();
    if (query.trim().length >= 2 && options.onPreviewSearch) {
      const activePreviewGeneration = ++previewGeneration;
      searchAssist = {
        ...searchAssist,
        previews: [],
        previewLoading: true,
      };
      previewDebounceTimer = setTimeout(() => {
        previewDebounceTimer = null;
        if (
          cleanedUp
          || !globalSearch.active
          || activePreviewGeneration !== previewGeneration
          || globalSearch.query !== query
        ) {
          return;
        }

        const controller = new AbortController();
        previewAbortController = controller;
        void options.onPreviewSearch?.({
          query,
          filters,
          signal: controller.signal,
          limit: getPreviewLimit(),
        }).then((previews) => {
          if (
            cleanedUp
            || controller.signal.aborted
            || !globalSearch.active
            || activePreviewGeneration !== previewGeneration
            || globalSearch.query !== query
          ) {
            return;
          }

          previewAbortController = null;
          searchAssist = {
            ...searchAssist,
            previews,
            previewLoading: false,
          };
          syncSearchAssistSelection();
          scheduleSearchRender();
        }).catch(() => {
          if (controller.signal.aborted) {
            return;
          }

          previewAbortController = null;
          searchAssist = {
            ...searchAssist,
            previews: [],
            previewLoading: false,
          };
          syncSearchAssistSelection();
          scheduleSearchRender();
        });
      }, PREVIEW_DEBOUNCE_MS);
      previewDebounceTimer.unref?.();
    } else {
      previewGeneration += 1;
      searchAssist = {
        ...searchAssist,
        previews: [],
        previewLoading: false,
      };
    }

    syncSearchAssistSelection();
  };
  const render = () => {
    lastRenderAt = Date.now();
    writeFrame(stdout, renderSearchTuiScreen({
      query: currentQuery,
      results: getResults(),
      sessions: getSessions(),
      state,
      width: stdout.columns ?? 80,
      height: stdout.rows ?? 24,
      caseSensitive: currentCaseSensitive,
      searching: !model.searchDone,
      sourceLabel: currentSearch.sourceLabel,
      rangeLabel: currentSearch.rangeLabel,
      cwdLabel: currentCwdLabel,
      progress: currentSearch.searchState?.progress ?? null,
      prompt: detailSearch.active
        ? renderInputPrompt("detail> ", detailSearch.query, detailSearch.cursor)
        : globalSearch.active
          ? renderInputPrompt("search> ", globalSearch.query, globalSearch.cursor)
          : null,
      searchHint: detailSearch.active
        ? "detail-search"
        : globalSearch.active
          ? "global-search"
          : null,
      home: globalSearch.home
        ? {
          active: true,
          query: globalSearch.query,
        }
        : null,
      filterPicker: filterPicker.active
        ? {
          active: true,
          rows: getTuiFilterRows(filterPicker.draftFilters),
          selected: filterPicker.selected,
          mode: filterPicker.mode,
          valueOptions: filterPicker.valueOptions,
          valueSelected: filterPicker.valueSelected,
        }
        : null,
      filtersSummary: getFiltersSummary(filterPicker.active ? filterPicker.draftFilters : filters),
      searchAssist: searchAssist.active ? searchAssist : null,
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
    cancelPreviewSearch();
    await disposeSearchSession(currentSearch);
    await cleanupTerminal(stdin, stdout, previousRawMode);
  };

  const bindSearchSession = (
    session: TuiSearchSession,
    selectedSessionId: string | null = null,
  ) => {
    detachSearchNotify(currentSearch);
    currentSearch = createActiveSearchSession(session);
    currentQuery = currentSearch.query;
    currentCaseSensitive = currentSearch.caseSensitive;
    currentCwdLabel = currentSearch.cwdLabel;
    model = createTuiSearchModel(
      currentSearch.results?.hits ?? [],
      !currentSearch.iterator,
      currentSearch.seedSessions ?? [],
    );
    state = createInitialTuiState();
    detailSearch = {
      active: false,
      query: "",
      cursor: 0,
      lastQuery: detailSearch.lastQuery,
    };
    globalSearch = {
      active: false,
      home: false,
      query: currentQuery,
      cursor: currentQuery.length,
    };
    filterPicker = {
      active: false,
      selected: 0,
      mode: "rows",
      draftFilters: filters,
      valueOptions: [],
      valueSelected: 0,
    };
    cancelPreviewSearch();
    searchAssist = {
      ...createSearchAssistState(options.historyEnabled ?? true),
      active: false,
    };
    searchGeneration += 1;
    pendingSearch = nextSearchEvent(currentSearch.iterator, searchGeneration);
    attachSearchNotify(currentSearch, () => {
      model.dirty = true;
      scheduleSearchRender();
    });

    if (selectedSessionId) {
      const seededSessions = getSessions();
      const selectedIndex = seededSessions.findIndex((item) => item.sessionId === selectedSessionId);
      if (selectedIndex >= 0) {
        const viewport = getPanelContentSize(stdout.columns ?? 80, stdout.rows ?? 24);
        const visibleSessions = getVisibleSessionCapacityForLayout(
          seededSessions,
          state,
          viewport.width,
          viewport.height,
        );
        state = clearStatus(moveTo(state, selectedIndex, visibleSessions));
      }
    }
  };

  const startSearch = async (
    query: string,
    reason: "submit" | "suggestion" | "filters" = "submit",
    selectedSessionId: string | null = null,
  ) => {
    const nextQuery = query.trim();
    if (!options.onStartSearch) {
      state = withStatus(state, "Search restart is unavailable in this view.");
      return;
    }

    if (!nextQuery) {
      state = withStatus(state, "Enter a keyword first.");
      return;
    }

    await disposeSearchSession(currentSearch);
    const seedSessions = (
      reason === "submit"
      && globalSearch.active
      && searchAssist.previews.length > 0
      && nextQuery === globalSearch.query.trim()
    )
      ? [...searchAssist.previews]
      : undefined;

    const session = await options.onStartSearch({
      query: nextQuery,
      filters,
      reason,
      seedSessions,
    });
    bindSearchSession(session, selectedSessionId);
  };

  const runLucky = async (query: string): Promise<number | null> => {
    const nextQuery = query.trim();
    if (!options.onLuckySearch) {
      state = withStatus(state, "Lucky search is unavailable in this view.");
      return null;
    }

    if (!nextQuery) {
      state = withStatus(state, "Enter a keyword first.");
      return null;
    }

    const result = await options.onLuckySearch({
      query: nextQuery,
      filters,
    });
    if (result.opened) {
      await finish();
      return 0;
    }

    state = withStatus(state, result.message ?? "No matches found.");
    return null;
  };

  const openFilterPicker = () => {
    filterPicker = {
      active: true,
      selected: 0,
      mode: "rows",
      draftFilters: filters,
      valueOptions: [],
      valueSelected: 0,
    };
  };

  const closeFilterPicker = async () => {
    const nextFilters = filterPicker.draftFilters;
    const changed = !sameTuiFilters(filters, nextFilters);
    const nextQuery = (globalSearch.active ? globalSearch.query : currentQuery).trim();

    filterPicker = {
      active: false,
      selected: 0,
      mode: "rows",
      draftFilters: filters,
      valueOptions: [],
      valueSelected: 0,
    };

    if (!changed) {
      if (globalSearch.active) {
        refreshSearchAssist();
      }
      state = clearStatus(state);
      return;
    }

    filters = nextFilters;
    state = clearStatus(state);
    if (nextQuery) {
      await startSearch(nextQuery, "filters");
      return;
    }

    if (globalSearch.active) {
      refreshSearchAssist();
    }
  };

  const updateGlobalSearchQuery = (query: string) => {
    globalSearch = {
      ...globalSearch,
      query,
      cursor: query.length,
    };
    searchAssist = {
      ...searchAssist,
      selection: "input",
      selectedIndex: 0,
    };
    state = clearStatus(state);
    refreshSearchAssist();
  };
  const updateGlobalSearchInput = (next: Pick<GlobalSearchState, "query" | "cursor">) => {
    globalSearch = {
      ...globalSearch,
      query: next.query,
      cursor: clamp(next.cursor, 0, next.query.length),
    };
    searchAssist = {
      ...searchAssist,
      selection: "input",
      selectedIndex: 0,
    };
    state = clearStatus(state);
    refreshSearchAssist();
  };
  const updateDetailSearchInput = (next: Pick<DetailSearchState, "query" | "cursor">) => {
    detailSearch = {
      ...detailSearch,
      query: next.query,
      cursor: clamp(next.cursor, 0, next.query.length),
    };
  };
  const enterHomeIdle = () => {
    cancelPreviewSearch();
    globalSearch = {
      active: false,
      home: true,
      query: "",
      cursor: 0,
    };
    searchAssist = {
      ...createSearchAssistState(options.historyEnabled ?? true),
      active: false,
    };
    state = clearStatus(state);
  };
  const returnToHome = async () => {
    await disposeSearchSession(currentSearch);
    searchGeneration += 1;
    currentSearch = createActiveSearchSession({
      query: "",
      caseSensitive: filters.caseSensitive,
      results: emptySearchResults(),
    });
    currentQuery = "";
    currentCaseSensitive = filters.caseSensitive;
    currentCwdLabel = undefined;
    model = createTuiSearchModel([], true);
    state = clearStatus(createInitialTuiState());
    detailSearch = {
      active: false,
      query: "",
      cursor: 0,
      lastQuery: detailSearch.lastQuery,
    };
    enterHomeIdle();
    filterPicker = {
      active: false,
      selected: 0,
      mode: "rows",
      draftFilters: filters,
      valueOptions: [],
      valueSelected: 0,
    };
    pendingSearch = null;
  };

  let pendingInput = waitForTuiEvent(stdin, stdout, options.signalSource ?? process).then((event) => ({
    type: "input" as const,
    event,
  }));
  let pendingSearch = nextSearchEvent(currentSearch.iterator, searchGeneration);
  const armInput = () => {
    pendingInput = waitForTuiEvent(stdin, stdout, options.signalSource ?? process).then((event) => ({
      type: "input" as const,
      event,
    }));
  };

  attachSearchNotify(currentSearch, () => {
    model.dirty = true;
    scheduleSearchRender();
  });

  refreshSearchAssist();
  render();
  scheduleAnimationRender();

  try {
    while (true) {
      const event = await Promise.race([
        pendingInput,
        ...(pendingSearch ? [pendingSearch] : []),
      ]);

      if (event.type === "search") {
        if (event.generation !== searchGeneration) {
          continue;
        }

        pendingSearch = null;
        if (event.result.done) {
          model.searchDone = true;
        } else {
          appendTuiSearchHit(model, event.result.value);
          pendingSearch = nextSearchEvent(currentSearch.iterator, searchGeneration);
        }

        if (model.searchDone) {
          clearAnimationRender();
          clearScheduledRender();
          render();
        } else {
          scheduleSearchRender();
          scheduleAnimationRender();
        }

        await yieldToEventLoop();
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
        if (globalSearch.active) {
          refreshSearchAssist();
        }
        armInput();
        clearScheduledRender();
        render();
        continue;
      }

      if (inputEvent.type === "signal") {
        return 0;
      }

      const key = inputEvent.key;
      const expanded = getExpandedSession(sessions, state);

      if (detailSearch.active) {
        if (key.ctrl && key.name === "c") {
          return 0;
        }

        if (key.name === "escape") {
          detailSearch = {
            ...detailSearch,
            active: false,
            query: "",
            cursor: 0,
          };
          state = clearStatus(state);
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "a") {
          updateDetailSearchInput(moveCursorToStart(detailSearch.query));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "e") {
          updateDetailSearchInput(moveCursorToEnd(detailSearch.query));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "u") {
          updateDetailSearchInput(deleteToStart(detailSearch.query, detailSearch.cursor));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "k") {
          updateDetailSearchInput(deleteToEnd(detailSearch.query, detailSearch.cursor));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "w") {
          updateDetailSearchInput(deleteWordBackward(detailSearch.query, detailSearch.cursor));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "left") {
          updateDetailSearchInput(
            key.meta ? moveCursorWordLeft(detailSearch.query, detailSearch.cursor) : moveCursor(detailSearch.query, detailSearch.cursor, -1),
          );
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "right") {
          updateDetailSearchInput(
            key.meta ? moveCursorWordRight(detailSearch.query, detailSearch.cursor) : moveCursor(detailSearch.query, detailSearch.cursor, 1),
          );
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "home" || (key.meta && key.name === "b")) {
          updateDetailSearchInput(moveCursorToStart(detailSearch.query));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "end" || (key.meta && key.name === "f")) {
          updateDetailSearchInput(moveCursorToEnd(detailSearch.query));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "backspace" || key.name === "delete") {
          updateDetailSearchInput(
            key.name === "backspace"
              ? deleteBackward(detailSearch.query, detailSearch.cursor)
              : deleteForward(detailSearch.query, detailSearch.cursor),
          );
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "return") {
          detailSearch = { ...detailSearch, active: false };
          if (!expanded || detailSearch.query.trim() === "") {
            detailSearch = { ...detailSearch, query: "", cursor: 0 };
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
                cursor: 0,
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
          updateDetailSearchInput(insertText(detailSearch.query, detailSearch.cursor, inputEvent.text));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        armInput();
        continue;
      }

      if (filterPicker.active) {
        if (key.ctrl && key.name === "c") {
          return 0;
        }

        if (key.name === "q") {
          return 0;
        }

        if (key.name === "escape") {
          if (filterPicker.mode === "values") {
            filterPicker = {
              ...filterPicker,
              mode: "rows",
              valueOptions: [],
              valueSelected: 0,
            };
          } else {
            await closeFilterPicker();
          }
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "up" || key.name === "k") {
          if (filterPicker.mode === "values") {
            filterPicker = {
              ...filterPicker,
              valueSelected: clamp(filterPicker.valueSelected - 1, 0, Math.max(0, filterPicker.valueOptions.length - 1)),
            };
          } else {
            filterPicker = {
              ...filterPicker,
              selected: clamp(filterPicker.selected - 1, 0, Math.max(0, getTuiFilterRows(filterPicker.draftFilters).length - 1)),
            };
          }
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "down" || key.name === "j") {
          if (filterPicker.mode === "values") {
            filterPicker = {
              ...filterPicker,
              valueSelected: clamp(filterPicker.valueSelected + 1, 0, Math.max(0, filterPicker.valueOptions.length - 1)),
            };
          } else {
            filterPicker = {
              ...filterPicker,
              selected: clamp(filterPicker.selected + 1, 0, Math.max(0, getTuiFilterRows(filterPicker.draftFilters).length - 1)),
            };
          }
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "return") {
          const rows = getTuiFilterRows(filterPicker.draftFilters);
          const row = rows[filterPicker.selected];
          if (filterPicker.mode === "rows") {
            if (row) {
              const valueOptions = getTuiFilterValueOptions(filterPicker.draftFilters, row.key);
              const valueSelected = Math.max(0, valueOptions.indexOf(row.value));
              filterPicker = {
                ...filterPicker,
                mode: "values",
                valueOptions,
                valueSelected,
              };
            }
          } else {
            const selectedValue = filterPicker.valueOptions[filterPicker.valueSelected];
            if (row && selectedValue) {
              filterPicker = {
                ...filterPicker,
                mode: "rows",
                draftFilters: applyTuiFilterValue(filterPicker.draftFilters, row.key, selectedValue),
                valueOptions: [],
                valueSelected: 0,
              };
            }
          }
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        armInput();
        continue;
      }

      if (globalSearch.active) {
        const assistItems = getSearchAssistItems(searchAssist);
        const selectedAssist = searchAssist.selection === "list"
          ? assistItems[searchAssist.selectedIndex] ?? null
          : null;

        if (key.ctrl && key.name === "c") {
          return 0;
        }

        if (key.name === "escape") {
          if (globalSearch.home) {
            enterHomeIdle();
          } else {
            cancelPreviewSearch();
            globalSearch = {
              active: false,
              home: false,
              query: currentQuery,
              cursor: currentQuery.length,
            };
            searchAssist = {
              ...createSearchAssistState(options.historyEnabled ?? true),
              active: false,
            };
            state = clearStatus(state);
          }
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "a") {
          updateGlobalSearchInput(moveCursorToStart(globalSearch.query));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "e") {
          updateGlobalSearchInput(moveCursorToEnd(globalSearch.query));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "u") {
          updateGlobalSearchInput(deleteToStart(globalSearch.query, globalSearch.cursor));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "k") {
          updateGlobalSearchInput(deleteToEnd(globalSearch.query, globalSearch.cursor));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "w") {
          updateGlobalSearchInput(deleteWordBackward(globalSearch.query, globalSearch.cursor));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "left") {
          updateGlobalSearchInput(
            key.meta ? moveCursorWordLeft(globalSearch.query, globalSearch.cursor) : moveCursor(globalSearch.query, globalSearch.cursor, -1),
          );
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "right") {
          updateGlobalSearchInput(
            key.meta ? moveCursorWordRight(globalSearch.query, globalSearch.cursor) : moveCursor(globalSearch.query, globalSearch.cursor, 1),
          );
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "home" || (key.meta && key.name === "b")) {
          updateGlobalSearchInput(moveCursorToStart(globalSearch.query));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "end" || (key.meta && key.name === "f")) {
          updateGlobalSearchInput(moveCursorToEnd(globalSearch.query));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "up") {
          if (assistItems.length > 0) {
            searchAssist = {
              ...searchAssist,
              selection: "list",
              selectedIndex: searchAssist.selection === "list"
                ? clamp(searchAssist.selectedIndex - 1, 0, Math.max(0, assistItems.length - 1))
                : Math.max(0, assistItems.length - 1),
            };
          }
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "down") {
          if (assistItems.length > 0) {
            searchAssist = {
              ...searchAssist,
              selection: "list",
              selectedIndex: searchAssist.selection === "list"
                ? clamp(searchAssist.selectedIndex + 1, 0, Math.max(0, assistItems.length - 1))
                : 0,
            };
          }
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "tab") {
          const acceptItem = selectedAssist ?? findFirstAcceptableAssistItem(assistItems);
          if (acceptItem && acceptItem.kind !== "preview") {
            updateGlobalSearchQuery(acceptItem.value);
          }
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if ((key.name === "backspace" || key.name === "delete") && searchAssist.selection === "list") {
          if (selectedAssist?.kind === "recent" && options.onDeleteRecentQuery) {
            const deleted = await options.onDeleteRecentQuery(selectedAssist.value);
            if (deleted) {
              searchAssist = {
                ...searchAssist,
                selection: "input",
                selectedIndex: 0,
              };
              refreshSearchAssist();
            }
          }
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.name === "backspace" || key.name === "delete") {
          updateGlobalSearchInput(
            key.name === "backspace"
              ? deleteBackward(globalSearch.query, globalSearch.cursor)
              : deleteForward(globalSearch.query, globalSearch.cursor),
          );
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (/^[1-5]$/.test(inputEvent.text)) {
          const preview = searchAssist.previews[Number(inputEvent.text) - 1];
          if (preview) {
            await startSearch(globalSearch.query, "submit", preview.sessionId);
            armInput();
            clearScheduledRender();
            render();
            continue;
          }
        }

        if (key.name === "return") {
          if (selectedAssist?.kind === "preview" && selectedAssist.preview) {
            await startSearch(globalSearch.query, "submit", selectedAssist.preview.sessionId);
          } else if (selectedAssist && selectedAssist.kind !== "preview") {
            await startSearch(selectedAssist.value, "suggestion");
          } else {
            await startSearch(globalSearch.query, "submit");
          }
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (key.ctrl && key.name === "f") {
          openFilterPicker();
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        if (isPrintableInput(inputEvent.text, key)) {
          updateGlobalSearchInput(insertText(globalSearch.query, globalSearch.cursor, inputEvent.text));
          armInput();
          clearScheduledRender();
          render();
          continue;
        }

        armInput();
        continue;
      }

      if (sessions.length === 0) {
        if (globalSearch.home) {
          if (key.ctrl && key.name === "c") {
            return 0;
          }

          if (key.name === "q") {
            return 0;
          }

          if (key.name === "return" || key.name === "s") {
            globalSearch = {
              active: true,
              home: true,
              query: "",
              cursor: 0,
            };
            searchAssist = {
              ...searchAssist,
              selection: "input",
              selectedIndex: 0,
            };
            refreshSearchAssist();
            armInput();
            clearScheduledRender();
            render();
            continue;
          }

          if (key.name === "f") {
            openFilterPicker();
            armInput();
            clearScheduledRender();
            render();
            continue;
          }

          if (isPrintableInput(inputEvent.text, key)) {
            globalSearch = {
              active: true,
              home: true,
              query: "",
              cursor: 0,
            };
            updateGlobalSearchInput(insertText("", 0, inputEvent.text));
            armInput();
            clearScheduledRender();
            render();
            continue;
          }

          armInput();
          continue;
        }

        if (key.ctrl && key.name === "c") {
          return 0;
        }
        if (key.name === "q") {
          return 0;
        }
        if (key.name === "escape") {
          await returnToHome();
          armInput();
          clearScheduledRender();
          render();
          continue;
        }
        if (key.name === "s") {
          globalSearch = {
            active: true,
            home: false,
            query: currentQuery,
            cursor: currentQuery.length,
          };
          searchAssist = {
            ...searchAssist,
            selection: "input",
            selectedIndex: 0,
          };
          refreshSearchAssist();
          armInput();
          clearScheduledRender();
          render();
          continue;
        }
        if (key.name === "f") {
          openFilterPicker();
          armInput();
          clearScheduledRender();
          render();
          continue;
        }
        armInput();
        continue;
      }

      if (key.ctrl && key.name === "c") {
        return 0;
      }

      if (key.name === "q") {
        return 0;
      }

      if (key.name === "escape") {
        await returnToHome();
        armInput();
        clearScheduledRender();
        render();
        continue;
      }

      if (key.ctrl && key.name === "o") {
        const exitCode = await runLucky(currentQuery);
        if (exitCode !== null) {
          return exitCode;
        }

        armInput();
        clearScheduledRender();
        render();
        continue;
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

        if (!hit) {
          armInput();
          continue;
        }

        const sourceLabel = currentSearch.sourceLabel;
        const rangeLabel = currentSearch.rangeLabel;
        const cwdLabel = currentCwdLabel;
        await disposeSearchSession(currentSearch);
        model.searchDone = true;
        searchGeneration += 1;
        currentSearch = createActiveSearchSession({
          query: currentQuery,
          caseSensitive: currentCaseSensitive,
          results: getResults(),
          sourceLabel,
          rangeLabel,
          cwdLabel,
        });
        pendingSearch = null;

        try {
          const resumeExitCode = await withSuspendedTerminal(
            stdin,
            stdout,
            async () => resumeHit(hit),
          );
          state = resumeExitCode === 0
            ? clearStatus(state)
            : withStatus(state, `codex resume exited with code ${resumeExitCode}.`);
        } catch (error) {
          state = withStatus(state, error instanceof Error ? error.message : "codex resume failed.");
        }

        armInput();
        clearScheduledRender();
        render();
        continue;
      }

      if (key.name === "s") {
        globalSearch = {
          active: true,
          home: false,
          query: currentQuery,
          cursor: currentQuery.length,
        };
        searchAssist = {
          ...searchAssist,
          selection: "input",
          selectedIndex: 0,
        };
        refreshSearchAssist();
        armInput();
        clearScheduledRender();
        render();
        continue;
      }

      if (key.name === "f") {
        openFilterPicker();
        armInput();
        clearScheduledRender();
        render();
        continue;
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
          : clearStatus(toggleExpandedSelectionForSessions(state, sessions));
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
          cursor: 0,
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
      const previewHeight = Math.max(0, detailPanelHeight - getDetailMetadataLineCount(detailPanelHeight, {
        hasCwd: Boolean(expanded?.cwd),
        hasActionLine: true,
        hasFilePath: Boolean(expanded?.filePath),
      }));
      const detailPageStep = expanded
        ? Math.max(
          1,
          measureVisibleDetailPreviewRange(
            expanded.matchPreviews,
            usesWideDetailsLayout(viewport.width)
              ? getSideBySidePaneWidths(viewport.width).rightWidth
              : viewport.width,
            previewHeight,
            state.detailScrollTop,
          ).renderedCount,
        )
        : 1;
      if (key.name === "space") {
        state = clearStatus(toggleExpandedSelectionForSessions(state, sessions));
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
    detachSearchNotify(currentSearch);
    await finish();
  }
}

function createActiveSearchSession(session: TuiSearchSession): ActiveSearchSession {
  return {
    query: session.query,
    caseSensitive: session.caseSensitive ?? false,
    results: session.results,
    seedSessions: session.seedSessions,
    iterator: session.hitStream?.[Symbol.asyncIterator](),
    cancelSearch: session.cancelSearch,
    sourceLabel: session.sourceLabel,
    rangeLabel: session.rangeLabel,
    cwdLabel: session.cwdLabel,
    searchState: session.searchState,
  };
}

function attachSearchNotify(
  session: ActiveSearchSession,
  notify: () => void,
): void {
  if (session.searchState) {
    session.searchState.notify = notify;
  }
}

function detachSearchNotify(session: ActiveSearchSession): void {
  if (session.searchState) {
    session.searchState.notify = undefined;
  }
}

async function disposeSearchSession(session: ActiveSearchSession): Promise<void> {
  session.cancelSearch?.();
  detachSearchNotify(session);
  await session.iterator?.return?.();
}

function createSearchAssistState(historyEnabled: boolean): TuiSearchAssistState {
  return {
    active: false,
    selection: "input",
    selectedIndex: 0,
    historyEnabled,
    recent: [],
    projects: [],
    previews: [],
    previewLoading: false,
  };
}

function getSearchAssistItems(searchAssist: TuiSearchAssistState): TuiSearchAssistItem[] {
  return [
    ...searchAssist.previews.map((preview) => ({
      kind: "preview" as const,
      value: preview.title || preview.sessionId,
      preview,
    })),
    ...searchAssist.recent.map((entry) => ({
      kind: "recent" as const,
      value: entry.value,
      count: entry.count,
    })),
    ...searchAssist.projects.map((entry) => ({
      kind: "project" as const,
      value: entry.value,
      count: entry.count,
    })),
  ];
}

function clampSearchAssistSelection(searchAssist: TuiSearchAssistState): TuiSearchAssistState {
  const items = getSearchAssistItems(searchAssist);
  if (items.length === 0) {
    return {
      ...searchAssist,
      selection: "input",
      selectedIndex: 0,
    };
  }

  return {
    ...searchAssist,
    selectedIndex: clamp(searchAssist.selectedIndex, 0, items.length - 1),
  };
}

function findFirstAcceptableAssistItem(
  items: TuiSearchAssistItem[],
): TuiSearchAssistItem | null {
  return items.find((item) => item.kind !== "preview") ?? null;
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

function createTuiSearchModel(
  initialHits: SearchHit[],
  searchDone: boolean,
  seedSessions: SearchSessionGroup[] = [],
): TuiSearchModel {
  return {
    hits: [...initialHits],
    seedSessions: [...seedSessions],
    sortedHits: [],
    sessions: [],
    searchDone,
    dirty: true,
  };
}

function appendTuiSearchHit(model: TuiSearchModel, hit: SearchHit): void {
  model.seedSessions = model.seedSessions.filter((session) => session.sessionId !== hit.sessionId);
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
  const confirmedSessions = aggregateSearchHitsBySessionWithSummaries(model.sortedHits, sessionSummaries);
  if (model.seedSessions.length === 0) {
    model.sessions = confirmedSessions;
    model.dirty = false;
    return;
  }

  const confirmedSessionIds = new Set(confirmedSessions.map((session) => session.sessionId));
  const provisionalSessions = model.seedSessions.filter((session) => !confirmedSessionIds.has(session.sessionId));
  model.sessions = [...confirmedSessions, ...provisionalSessions]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
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
  const previewHeight = Math.max(0, detailHeight - getDetailMetadataLineCount(detailHeight, {
    hasCwd: Boolean(expanded.cwd),
    hasActionLine: true,
    hasFilePath: Boolean(expanded.filePath),
  }));
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

  return hits.find((hit) => hit.sessionId === sessionId)
    ?? (sessions[selectedIndex] ? sessionGroupToHit(sessions[selectedIndex]!) : null);
}

function sessionGroupToHit(session: SearchSessionGroup): SearchHit {
  return {
    sessionId: session.sessionId,
    timestamp: session.timestamp,
    cwd: session.cwd,
    title: session.title,
    snippet: session.previewSnippet,
    preview: session.matchPreviews[0] ?? {
      kind: "text",
      label: "Text",
      text: session.previewSnippet,
      timestamp: session.timestamp,
      secondaryText: null,
    },
    source: session.source,
    filePath: "",
    resumeCommand: session.resumeCommand,
    deepLink: session.deepLink,
  };
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

function emptySearchResults(): SearchResultsPage {
  return {
    hits: [],
    page: 1,
    pageSize: 5,
    offset: 0,
    hasMore: false,
  };
}

function renderInputPrompt(prefix: string, query: string, cursor: number): string {
  const clampedCursor = clamp(cursor, 0, query.length);
  const before = query.slice(0, clampedCursor);
  const current = query[clampedCursor] ?? " ";
  const after = query.slice(clampedCursor + (clampedCursor < query.length ? 1 : 0));
  return `${prefix}${before}${ANSI.inverse}${current}${ANSI.reset}${after}`;
}

function insertText(query: string, cursor: number, text: string): { query: string; cursor: number } {
  const clampedCursor = clamp(cursor, 0, query.length);
  return {
    query: `${query.slice(0, clampedCursor)}${text}${query.slice(clampedCursor)}`,
    cursor: clampedCursor + text.length,
  };
}

function deleteBackward(query: string, cursor: number): { query: string; cursor: number } {
  const clampedCursor = clamp(cursor, 0, query.length);
  if (clampedCursor === 0) {
    return { query, cursor: clampedCursor };
  }

  return {
    query: `${query.slice(0, clampedCursor - 1)}${query.slice(clampedCursor)}`,
    cursor: clampedCursor - 1,
  };
}

function deleteForward(query: string, cursor: number): { query: string; cursor: number } {
  const clampedCursor = clamp(cursor, 0, query.length);
  if (clampedCursor >= query.length) {
    return { query, cursor: clampedCursor };
  }

  return {
    query: `${query.slice(0, clampedCursor)}${query.slice(clampedCursor + 1)}`,
    cursor: clampedCursor,
  };
}

function deleteToStart(query: string, cursor: number): { query: string; cursor: number } {
  const clampedCursor = clamp(cursor, 0, query.length);
  return {
    query: query.slice(clampedCursor),
    cursor: 0,
  };
}

function deleteToEnd(query: string, cursor: number): { query: string; cursor: number } {
  const clampedCursor = clamp(cursor, 0, query.length);
  return {
    query: query.slice(0, clampedCursor),
    cursor: clampedCursor,
  };
}

function deleteWordBackward(query: string, cursor: number): { query: string; cursor: number } {
  let nextCursor = clamp(cursor, 0, query.length);
  if (nextCursor === 0) {
    return { query, cursor: nextCursor };
  }

  while (nextCursor > 0 && /\s/.test(query[nextCursor - 1] ?? "")) {
    nextCursor -= 1;
  }
  while (nextCursor > 0 && !/\s/.test(query[nextCursor - 1] ?? "")) {
    nextCursor -= 1;
  }

  return {
    query: `${query.slice(0, nextCursor)}${query.slice(clamp(cursor, 0, query.length))}`,
    cursor: nextCursor,
  };
}

function moveCursor(query: string, cursor: number, delta: number): { query: string; cursor: number } {
  return {
    query,
    cursor: clamp(cursor + delta, 0, query.length),
  };
}

function moveCursorToStart(query: string): { query: string; cursor: number } {
  return {
    query,
    cursor: 0,
  };
}

function moveCursorToEnd(query: string): { query: string; cursor: number } {
  return {
    query,
    cursor: query.length,
  };
}

function moveCursorWordLeft(query: string, cursor: number): { query: string; cursor: number } {
  let nextCursor = clamp(cursor, 0, query.length);
  while (nextCursor > 0 && /\s/.test(query[nextCursor - 1] ?? "")) {
    nextCursor -= 1;
  }
  while (nextCursor > 0 && !/\s/.test(query[nextCursor - 1] ?? "")) {
    nextCursor -= 1;
  }
  return { query, cursor: nextCursor };
}

function moveCursorWordRight(query: string, cursor: number): { query: string; cursor: number } {
  let nextCursor = clamp(cursor, 0, query.length);
  while (nextCursor < query.length && /\s/.test(query[nextCursor] ?? "")) {
    nextCursor += 1;
  }
  while (nextCursor < query.length && !/\s/.test(query[nextCursor] ?? "")) {
    nextCursor += 1;
  }
  return { query, cursor: nextCursor };
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

async function withSuspendedTerminal<T>(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  action: () => Promise<T>,
): Promise<T> {
  stdin.setRawMode?.(false);
  stdout.write(`${ANSI.reset}${ANSI.showCursor}${ANSI.altOff}`);

  try {
    return await action();
  } finally {
    stdout.write(`${ANSI.altOn}${ANSI.hideCursor}`);
    stdin.setRawMode?.(true);
    stdin.resume();
  }
}

function writeFrame(stdout: NodeJS.WriteStream, screen: string): void {
  stdout.write(`${ANSI.clear}${ANSI.home}${screen}`);
}

function nextSearchEvent(
  iterator: AsyncIterator<SearchHit> | undefined,
  generation: number,
): Promise<SearchEventEnvelope> | null {
  if (!iterator) {
    return null;
  }

  return iterator.next().then((result) => ({
    type: "search" as const,
    generation,
    result,
  }));
}

function waitForTuiEvent(
  stdin: NodeJS.ReadStream,
  stdout: NodeJS.WriteStream,
  signalSource: Pick<NodeJS.Process, "on" | "off">,
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
    const signalHandlers = EXIT_SIGNALS.map((signal) => {
      const onSignal = () => {
        cleanup();
        resolve({ type: "signal", signal });
      };

      signalSource.on(signal, onSignal);
      return { signal, onSignal };
    });
    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdout.off("resize", onResize);
      for (const { signal, onSignal } of signalHandlers) {
        signalSource.off(signal, onSignal);
      }
    };

    stdin.on("keypress", onKeypress);
    stdout.on("resize", onResize);
  });
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
