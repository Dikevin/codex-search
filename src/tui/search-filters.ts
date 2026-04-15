import type { SearchViewMode } from "../search/view-filter.js";

export type TuiSourceMode = "active" | "archived" | "all";

export type TuiTimeFilter =
  | { kind: "recent"; value: string }
  | { kind: "range"; start: string | null; end: string | null }
  | { kind: "all-time" };

export interface TuiSearchFilters {
  sourceMode: TuiSourceMode;
  view: SearchViewMode;
  caseSensitive: boolean;
  timeFilter: TuiTimeFilter;
}

export type TuiFilterRowKey = "source" | "range" | "view" | "case";

export interface TuiFilterRow {
  key: TuiFilterRowKey;
  label: string;
  value: string;
}

const SOURCE_OPTIONS: readonly TuiSourceMode[] = ["active", "archived", "all"];
const VIEW_OPTIONS: readonly SearchViewMode[] = ["useful", "ops", "protocol", "all"];
const CASE_OPTIONS = [false, true] as const;
const RECENT_OPTIONS = ["1d", "7d", "30d"] as const;

export function createDefaultTuiFilters(): TuiSearchFilters {
  return {
    sourceMode: "active",
    view: "useful",
    caseSensitive: false,
    timeFilter: {
      kind: "recent",
      value: "30d",
    },
  };
}

export function getTuiFilterRows(filters: TuiSearchFilters): TuiFilterRow[] {
  return [
    {
      key: "source",
      label: "Source",
      value: filters.sourceMode,
    },
    {
      key: "range",
      label: "Range",
      value: formatTuiTimeFilter(filters.timeFilter),
    },
    {
      key: "view",
      label: "View",
      value: filters.view,
    },
    {
      key: "case",
      label: "Case",
      value: filters.caseSensitive ? "exact" : "ignore",
    },
  ];
}

export function formatTuiTimeFilter(timeFilter: TuiTimeFilter): string {
  if (timeFilter.kind === "all-time") {
    return "all-time";
  }

  if (timeFilter.kind === "recent") {
    return timeFilter.value;
  }

  return `${timeFilter.start ?? "begin"}..${timeFilter.end ?? "today"}`;
}

export function formatTuiRangeLabel(filters: TuiSearchFilters): string {
  if (filters.timeFilter.kind === "all-time") {
    return "all time";
  }

  if (filters.timeFilter.kind === "recent") {
    return `recent ${filters.timeFilter.value}`;
  }

  return `${filters.timeFilter.start ?? "begin"}..${filters.timeFilter.end ?? "today"}`;
}

export function formatCompactFilterSummary(
  filters: TuiSearchFilters,
  cwdLabel?: string,
): string {
  const parts = [
    filters.sourceMode,
    formatTuiTimeFilter(filters.timeFilter),
    filters.view,
    filters.caseSensitive ? "exact case" : "ignore case",
    cwdLabel ? `cwd ${cwdLabel}` : null,
  ].filter(Boolean) as string[];

  return parts.join(" · ");
}

export function cycleTuiFilterValue(
  filters: TuiSearchFilters,
  rowKey: TuiFilterRowKey,
  direction: -1 | 1,
): TuiSearchFilters {
  if (rowKey === "source") {
    return {
      ...filters,
      sourceMode: cycleValue(SOURCE_OPTIONS, filters.sourceMode, direction),
    };
  }

  if (rowKey === "view") {
    return {
      ...filters,
      view: cycleValue(VIEW_OPTIONS, filters.view, direction),
    };
  }

  if (rowKey === "case") {
    return {
      ...filters,
      caseSensitive: cycleValue(CASE_OPTIONS, filters.caseSensitive, direction),
    };
  }

  return {
    ...filters,
    timeFilter: cycleTimeFilter(filters.timeFilter, direction),
  };
}

export function getTuiFilterValueOptions(
  filters: TuiSearchFilters,
  rowKey: TuiFilterRowKey,
): string[] {
  if (rowKey === "source") {
    return [...SOURCE_OPTIONS];
  }

  if (rowKey === "view") {
    return [...VIEW_OPTIONS];
  }

  if (rowKey === "case") {
    return CASE_OPTIONS.map((value) => (value ? "exact" : "ignore"));
  }

  return [...getTimeFilterOptions(filters.timeFilter)];
}

export function applyTuiFilterValue(
  filters: TuiSearchFilters,
  rowKey: TuiFilterRowKey,
  value: string,
): TuiSearchFilters {
  if (rowKey === "source") {
    return {
      ...filters,
      sourceMode: value as TuiSourceMode,
    };
  }

  if (rowKey === "view") {
    return {
      ...filters,
      view: value as SearchViewMode,
    };
  }

  if (rowKey === "case") {
    return {
      ...filters,
      caseSensitive: value === "exact",
    };
  }

  if (value === "all-time") {
    return {
      ...filters,
      timeFilter: { kind: "all-time" },
    };
  }

  if (value.includes("..")) {
    const [start, end] = value.split("..");
    return {
      ...filters,
      timeFilter: {
        kind: "range",
        start: start && start !== "begin" ? start : null,
        end: end && end !== "today" ? end : null,
      },
    };
  }

  return {
    ...filters,
    timeFilter: {
      kind: "recent",
      value,
    },
  };
}

export function sameTuiFilters(
  left: TuiSearchFilters,
  right: TuiSearchFilters,
): boolean {
  return left.sourceMode === right.sourceMode
    && left.view === right.view
    && left.caseSensitive === right.caseSensitive
    && formatTuiTimeFilter(left.timeFilter) === formatTuiTimeFilter(right.timeFilter);
}

function cycleTimeFilter(
  timeFilter: TuiTimeFilter,
  direction: -1 | 1,
): TuiTimeFilter {
  const options = getTimeFilterOptions(timeFilter);
  const currentLabel = formatTuiTimeFilter(timeFilter);
  const next = cycleValue(options, currentLabel, direction);

  if (next === "all-time") {
    return { kind: "all-time" };
  }

  if (next.includes("..")) {
    const [start, end] = next.split("..");
    return {
      kind: "range",
      start: start && start !== "begin" ? start : null,
      end: end && end !== "today" ? end : null,
    };
  }

  return {
    kind: "recent",
    value: next,
  };
}

function getTimeFilterOptions(timeFilter: TuiTimeFilter): readonly string[] {
  const currentLabel = formatTuiTimeFilter(timeFilter);
  if (timeFilter.kind === "range") {
    return [currentLabel, ...RECENT_OPTIONS, "all-time"];
  }

  return [...RECENT_OPTIONS, "all-time"];
}

function cycleValue<T>(
  values: readonly T[],
  current: T,
  direction: -1 | 1,
): T {
  const currentIndex = Math.max(0, values.indexOf(current));
  const nextIndex = (currentIndex + direction + values.length) % values.length;
  return values[nextIndex]!;
}
