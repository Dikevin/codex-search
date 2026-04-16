import type readline from "node:readline";

import type {
  SearchHit,
  SearchResultsPage,
  SearchSessionGroup,
  SearchSessionSummary,
} from "../search/session-reader.js";
import type { SearchProgress } from "../search/view-filter.js";
import type {
  TuiFilterRow,
  TuiFilterRowState,
  TuiSearchFilters,
} from "./search-filters.js";

export interface TuiStreams {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

export interface TuiActions {
  openHit(hit: SearchHit, origin?: "list" | "preview"): Promise<void>;
  resumeHit(hit: SearchHit): Promise<number>;
}

export interface TuiSearchSession {
  query: string;
  caseSensitive?: boolean;
  results?: SearchResultsPage;
  seedSessions?: SearchSessionGroup[];
  hitStream?: AsyncIterable<SearchHit>;
  cancelSearch?: () => void;
  sourceLabel?: string;
  rangeLabel?: string;
  cwdLabel?: string;
  searchState?: {
    progress?: SearchProgress | null;
    sessionSummaries?: Map<string, SearchSessionSummary>;
    notify?: () => void;
  };
}

export interface TuiQuerySuggestion {
  kind: "recent" | "project";
  value: string;
  count?: number;
}

export interface TuiSearchAssistItem {
  kind: "recent" | "project" | "preview";
  value: string;
  count?: number;
  preview?: SearchSessionGroup;
}

export interface RunSearchTuiOptions extends Partial<TuiStreams>, Partial<TuiActions> {
  query: string;
  caseSensitive?: boolean;
  signalSource?: Pick<NodeJS.Process, "on" | "off">;
  results?: SearchResultsPage;
  hitStream?: AsyncIterable<SearchHit>;
  cancelSearch?: () => void;
  sourceLabel?: string;
  rangeLabel?: string;
  cwdLabel?: string;
  searchState?: {
    progress?: SearchProgress | null;
    sessionSummaries?: Map<string, SearchSessionSummary>;
    notify?: () => void;
  };
  initialFilters?: TuiSearchFilters;
  historyEnabled?: boolean;
  onStartSearch?: (request: {
    query: string;
    filters: TuiSearchFilters;
    reason?: "submit" | "suggestion" | "filters";
    seedSessions?: SearchSessionGroup[];
  }) => Promise<TuiSearchSession>;
  onLuckySearch?: (request: { query: string; filters: TuiSearchFilters }) => Promise<{
    opened: boolean;
    message?: string;
  }>;
  onLoadSuggestions?: (request: {
    query: string;
    limit: number;
  }) => Promise<{
    recent: TuiQuerySuggestion[];
    projects: TuiQuerySuggestion[];
  }>;
  onPreviewSearch?: (request: {
    query: string;
    filters: TuiSearchFilters;
    signal: AbortSignal;
    limit: number;
  }) => Promise<SearchSessionGroup[]>;
  onDeleteRecentQuery?: (query: string) => Promise<boolean>;
}

export interface TuiState {
  selected: number;
  scrollTop: number;
  expandedSessionId: string | null;
  focus: "list" | "detail";
  detailSelected: number;
  detailScrollTop: number;
  statusMessage: string | null;
}

export interface TuiFilterPickerState {
  active: boolean;
  rows: TuiFilterRowState[];
  selected: number;
  mode: "rows" | "values";
  valueOptions?: string[];
  valueSelected?: number;
}

export interface TuiHomeState {
  active: boolean;
  query: string;
}

export interface TuiSearchAssistState {
  active: boolean;
  selection: "input" | "list";
  selectedIndex: number;
  historyEnabled: boolean;
  recent: TuiQuerySuggestion[];
  projects: TuiQuerySuggestion[];
  previews: SearchSessionGroup[];
  previewLoading: boolean;
}

export interface RenderSearchTuiScreenOptions {
  query: string;
  results: SearchResultsPage;
  sessions?: SearchSessionGroup[];
  state: TuiState;
  width: number;
  height: number;
  nowMs?: number;
  caseSensitive?: boolean;
  searching?: boolean;
  sourceLabel?: string;
  rangeLabel?: string;
  cwdLabel?: string;
  progress?: SearchProgress | null;
  prompt?: string | null;
  searchHint?: string | null;
  home?: TuiHomeState | null;
  filterPicker?: TuiFilterPickerState | null;
  filtersSummary?: string | null;
  searchAssist?: TuiSearchAssistState | null;
}

export type TuiInputEvent =
  | { type: "key"; key: readline.Key; text: string }
  | { type: "resize" }
  | { type: "signal"; signal: NodeJS.Signals };

export type SearchStreamEvent = {
  type: "search";
  result: IteratorResult<SearchHit>;
};
