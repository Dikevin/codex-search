import type readline from "node:readline";

import type {
  SearchHit,
  SearchResultsPage,
  SearchSessionGroup,
  SearchSessionSummary,
} from "../search/session-reader.js";
import type { SearchProgress } from "../search/view-filter.js";

export interface TuiStreams {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

export interface TuiActions {
  openHit(hit: SearchHit): Promise<void>;
  resumeHit(hit: SearchHit): Promise<number>;
}

export interface RunSearchTuiOptions extends Partial<TuiStreams>, Partial<TuiActions> {
  query: string;
  caseSensitive?: boolean;
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
}

export type TuiInputEvent =
  | { type: "key"; key: readline.Key; text: string }
  | { type: "resize" };

export type SearchStreamEvent = {
  type: "search";
  result: IteratorResult<SearchHit>;
};
