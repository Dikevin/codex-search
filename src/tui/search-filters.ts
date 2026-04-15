import type { SearchArchivedSessionsOptions, SearchSource } from "../search/session-reader.js";
import type { SearchViewMode } from "../search/view-filter.js";

export type TuiSourceMode = "active" | "archived" | "all";
export type TuiRangePreset = "1d" | "7d" | "30d" | "all-time" | "custom";
export type TuiFilterRow = "source" | "range" | "view" | "case";

export interface TuiSearchFilters {
  sourceMode: TuiSourceMode;
  view: SearchViewMode;
  caseSensitive: boolean;
  range: TuiRangePreset;
  recent: string | null;
  start: string | null;
  end: string | null;
  allTime: boolean;
}

export interface TuiFilterRowState {
  key: TuiFilterRow;
  label: string;
  value: string;
}

export const FILTER_ROW_ORDER: readonly TuiFilterRow[] = [
  "source",
  "range",
  "view",
  "case",
] as const;

const SOURCE_OPTIONS: readonly TuiSourceMode[] = [
  "active",
  "archived",
  "all",
] as const;

const RANGE_OPTIONS: readonly Exclude<TuiRangePreset, "custom">[] = [
  "1d",
  "7d",
  "30d",
  "all-time",
] as const;

const VIEW_OPTIONS: readonly SearchViewMode[] = [
  "useful",
  "ops",
  "protocol",
  "all",
] as const;

const CASE_OPTIONS: readonly boolean[] = [
  false,
  true,
] as const;

export function createTuiSearchFilters(options: {
  sourceMode: TuiSourceMode;
  view: SearchViewMode;
  caseSensitive: boolean;
  recent: string | null;
  start: string | null;
  end: string | null;
  allTime: boolean;
}): TuiSearchFilters {
  return {
    sourceMode: options.sourceMode,
    view: options.view,
    caseSensitive: options.caseSensitive,
    range: resolveRangePreset(options.recent, options.start, options.end, options.allTime),
    recent: options.recent,
    start: options.start,
    end: options.end,
    allTime: options.allTime,
  };
}

export function createDefaultTuiFilters(): TuiSearchFilters {
  return createTuiSearchFilters({
    sourceMode: "active",
    view: "useful",
    caseSensitive: false,
    recent: "30d",
    start: null,
    end: null,
    allTime: false,
  });
}

export function resolveSources(sourceMode: TuiSourceMode): SearchSource[] {
  return sourceMode === "all"
    ? ["active", "archived"]
    : [sourceMode];
}

export function formatSourceLabel(sourceMode: TuiSourceMode): string {
  return sourceMode;
}

export function formatRangeLabel(filters: TuiSearchFilters): string {
  if (filters.allTime) {
    return "all time";
  }

  if (filters.recent) {
    return `recent ${filters.recent}`;
  }

  if (filters.start || filters.end) {
    return `${filters.start ?? "begin"}..${filters.end ?? "today"}`;
  }

  return "recent 30d";
}

export const formatTuiRangeLabel = formatRangeLabel;

export function formatFilterSummary(filters: TuiSearchFilters): string {
  return [
    filters.sourceMode,
    formatShortRange(filters),
    filters.view,
    filters.caseSensitive ? "exact case" : "ignore case",
  ].join(" · ");
}

export function formatCompactFilterSummary(filters: TuiSearchFilters, cwdLabel?: string | null): string {
  const parts = [
    formatFilterSummary(filters),
    cwdLabel ? `cwd ${cwdLabel}` : null,
  ].filter(Boolean) as string[];
  return parts.join(" · ");
}

export function cycleFilterRow(
  filters: TuiSearchFilters,
  row: TuiFilterRow,
  direction: 1 | -1,
): TuiSearchFilters {
  if (row === "source") {
    return {
      ...filters,
      sourceMode: cycleValue(SOURCE_OPTIONS, filters.sourceMode, direction),
    };
  }

  if (row === "range") {
    return applyRangePreset(filters, cycleValue(RANGE_OPTIONS, normalizeRangeForCycling(filters.range), direction));
  }

  if (row === "view") {
    return {
      ...filters,
      view: cycleValue(VIEW_OPTIONS, filters.view, direction),
    };
  }

  return {
    ...filters,
    caseSensitive: cycleValue(CASE_OPTIONS, filters.caseSensitive, direction),
  };
}

export function applyTuiFilterValue(
  filters: TuiSearchFilters,
  row: TuiFilterRow,
  value: string,
): TuiSearchFilters {
  if (row === "source" && (value === "active" || value === "archived" || value === "all")) {
    return {
      ...filters,
      sourceMode: value,
    };
  }

  if (row === "range" && (value === "1d" || value === "7d" || value === "30d" || value === "all-time")) {
    return applyRangePreset(filters, value);
  }

  if (row === "range" && value === "custom") {
    return filters;
  }

  if (row === "view" && (value === "useful" || value === "ops" || value === "protocol" || value === "all")) {
    return {
      ...filters,
      view: value,
    };
  }

  if (row === "case") {
    return {
      ...filters,
      caseSensitive: value === "exact",
    };
  }

  return filters;
}

export function formatFilterRowValue(filters: TuiSearchFilters, row: TuiFilterRow): string {
  if (row === "source") {
    return filters.sourceMode;
  }

  if (row === "range") {
    return formatShortRange(filters);
  }

  if (row === "view") {
    return filters.view;
  }

  return filters.caseSensitive ? "exact" : "ignore";
}

export function getTuiFilterRows(filters: TuiSearchFilters): TuiFilterRowState[] {
  return FILTER_ROW_ORDER.map((key) => ({
    key,
    label: key === "source"
      ? "Source"
      : key === "range"
        ? "Range"
        : key === "view"
          ? "View"
          : "Case",
    value: formatFilterRowValue(filters, key),
  }));
}

export function getTuiFilterValueOptions(
  filters: TuiSearchFilters,
  row: TuiFilterRow,
): string[] {
  if (row === "source") {
    return [...SOURCE_OPTIONS];
  }

  if (row === "range") {
    const options = [...RANGE_OPTIONS];
    if (filters.range === "custom") {
      return ["custom", ...options];
    }
    return options;
  }

  if (row === "view") {
    return [...VIEW_OPTIONS];
  }

  return ["ignore", "exact"];
}

export function sameTuiFilters(left: TuiSearchFilters, right: TuiSearchFilters): boolean {
  return left.sourceMode === right.sourceMode
    && left.view === right.view
    && left.caseSensitive === right.caseSensitive
    && left.range === right.range
    && left.recent === right.recent
    && left.start === right.start
    && left.end === right.end
    && left.allTime === right.allTime;
}

export function toSearchOptions(filters: TuiSearchFilters): Pick<
  SearchArchivedSessionsOptions,
  "sources" | "view" | "caseSensitive" | "recent" | "start" | "end" | "allTime"
> {
  return {
    sources: resolveSources(filters.sourceMode),
    view: filters.view,
    caseSensitive: filters.caseSensitive,
    recent: filters.recent ?? undefined,
    start: filters.start ?? undefined,
    end: filters.end ?? undefined,
    allTime: filters.allTime,
  };
}

function resolveRangePreset(
  recent: string | null,
  start: string | null,
  end: string | null,
  allTime: boolean,
): TuiRangePreset {
  if (allTime) {
    return "all-time";
  }

  if (recent === "1d" || recent === "7d" || recent === "30d") {
    return recent;
  }

  if (start || end) {
    return "custom";
  }

  return "30d";
}

function normalizeRangeForCycling(range: TuiRangePreset): Exclude<TuiRangePreset, "custom"> {
  return range === "custom" ? "30d" : range;
}

function applyRangePreset(filters: TuiSearchFilters, range: Exclude<TuiRangePreset, "custom">): TuiSearchFilters {
  if (range === "all-time") {
    return {
      ...filters,
      range,
      recent: null,
      start: null,
      end: null,
      allTime: true,
    };
  }

  return {
    ...filters,
    range,
    recent: range,
    start: null,
    end: null,
    allTime: false,
  };
}

function formatShortRange(filters: TuiSearchFilters): string {
  if (filters.allTime) {
    return "all-time";
  }

  if (filters.recent) {
    return filters.recent;
  }

  if (filters.start || filters.end) {
    return "custom";
  }

  return "30d";
}

function cycleValue<T extends string | boolean>(
  values: readonly T[],
  current: T,
  direction: 1 | -1,
): T {
  const currentIndex = values.indexOf(current);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = (startIndex + direction + values.length) % values.length;
  return values[nextIndex]!;
}
