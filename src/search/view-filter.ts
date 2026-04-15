import { isBoilerplatePreviewText } from "./match-preview.js";
import type { SearchHit } from "./session-reader.js";

export type SearchViewMode = "useful" | "ops" | "protocol" | "all";
export type SearchFileProgressState = "scanning" | "done";

export interface SearchProgress {
  totalFiles: number;
  readyFiles: number;
  scannedFiles: number;
  activeFiles: number;
  fileStates: Record<string, SearchFileProgressState>;
}

const PROTOCOL_TEXT_PATTERNS = [
  "agents.md",
  "skill.md",
  "skills_instructions",
  "plugins_instructions",
  "project-doc",
  "startup order",
  "working rules",
  "how to use skills",
  "tools are grouped by namespace",
  "system prompt",
  "agent prompt",
  "developer prompt",
  "collaboration mode",
];

export function matchesSearchView(hit: SearchHit, view: SearchViewMode): boolean {
  if (view === "all") {
    return true;
  }

  const tags = getSearchViewTags(hit);
  if (view === "ops") {
    return tags.has("useful") || tags.has("ops");
  }

  return tags.has(view);
}

function getSearchViewTags(hit: SearchHit): Set<Exclude<SearchViewMode, "all">> {
  const preview = hit.preview;
  const combinedText = [
    preview.text,
    preview.secondaryText ?? "",
    hit.snippet,
  ].join("\n");
  const tags = new Set<Exclude<SearchViewMode, "all">>();
  const protocol = isProtocolNoiseText(combinedText);
  const secondaryType = preview.secondaryText ?? "";

  if (preview.kind === "developer" || preview.kind === "system" || preview.kind === "reasoning" || preview.kind === "meta") {
    tags.add("protocol");
    return tags;
  }

  if (protocol) {
    tags.add("protocol");
    return tags;
  }

  if (preview.kind === "tool") {
    tags.add("ops");
    return tags;
  }

  if (preview.kind === "command" || preview.kind === "output") {
    tags.add("useful");
    tags.add("ops");
    return tags;
  }

  if (preview.kind === "user" || preview.kind === "assistant" || preview.kind === "file") {
    tags.add("useful");
    return tags;
  }

  if (secondaryType === "agent_message" || secondaryType === "task_complete") {
    return tags;
  }

  tags.add("useful");
  return tags;
}

function isProtocolNoiseText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (isBoilerplatePreviewText(normalized)) {
    return true;
  }

  return PROTOCOL_TEXT_PATTERNS.some((pattern) => normalized.includes(pattern));
}
