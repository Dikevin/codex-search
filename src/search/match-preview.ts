import type { SearchMatchPreview } from "./session-reader.ts";

const MAX_SNIPPET_LENGTH = 160;

export function buildMatchPreview(line: string, snippet: string): SearchMatchPreview {
  const parsed = tryParseJson(line);
  if (!isRecord(parsed)) {
    return {
      kind: "text",
      label: "Text",
      text: snippet,
      timestamp: null,
      secondaryText: null,
    };
  }

  const payload = isRecord(parsed.payload) ? parsed.payload : null;
  const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : null;

  if (parsed.type === "session_meta") {
    return {
      kind: "meta",
      label: "Session",
      text: typeof payload?.cwd === "string" ? payload.cwd : snippet,
      timestamp,
      secondaryText: typeof payload?.originator === "string" ? payload.originator : null,
    };
  }

  if (parsed.type === "response_item" && payload) {
    return buildResponseItemPreview(payload, snippet, timestamp);
  }

  if (parsed.type === "event_msg" && payload) {
    return buildEventPreview(payload, snippet, timestamp);
  }

  return {
    kind: "text",
    label: "Text",
    text: snippet,
    timestamp,
    secondaryText: null,
  };
}

function buildResponseItemPreview(
  payload: Record<string, unknown>,
  snippet: string,
  timestamp: string | null,
): SearchMatchPreview {
  const responseType = typeof payload.type === "string" ? payload.type : null;
  if (responseType === "message") {
    const role = normalizeRole(typeof payload.role === "string" ? payload.role : null);
    return {
      kind: role,
      label: capitalizeLabel(role),
      text: chooseDisplayText(extractContentText(payload.content), snippet),
      timestamp,
      secondaryText: null,
    };
  }

  if (Array.isArray(payload.summary)) {
    const summary = payload.summary
      .filter((item): item is string => typeof item === "string")
      .join(" ")
      .trim();
    if (summary) {
      return {
        kind: "reasoning",
        label: "Reasoning",
        text: summary,
        timestamp,
        secondaryText: null,
      };
    }
  }

  if (typeof payload.command === "string") {
    return {
      kind: "command",
      label: "Command",
      text: payload.command,
      timestamp,
      secondaryText: typeof payload.aggregated_output === "string"
        ? trimTextPreview(stripExecutionEnvelope(payload.aggregated_output))
        : null,
    };
  }

  if (typeof payload.tool === "string" || typeof payload.server === "string" || typeof payload.name === "string") {
    const toolName = [
      typeof payload.server === "string" ? payload.server : null,
      typeof payload.tool === "string" ? payload.tool : null,
      typeof payload.name === "string" ? payload.name : null,
    ].filter(Boolean).join("/");
    return {
      kind: "tool",
      label: "Tool",
      text: toolName || snippet,
      timestamp,
      secondaryText: typeof payload.arguments === "string" ? trimTextPreview(payload.arguments) : null,
    };
  }

  if (Array.isArray(payload.changes)) {
    const changes = payload.changes
      .map((change) => isRecord(change) && typeof change.path === "string" ? change.path : null)
      .filter((value): value is string => Boolean(value));
    return {
      kind: "file",
      label: "Files",
      text: changes.slice(0, 3).join(", ") || snippet,
      timestamp,
      secondaryText: changes.length > 3 ? `+${changes.length - 3} more` : null,
    };
  }

  if (responseType === "function_call_output") {
    const output = typeof payload.output === "string"
      ? trimTextPreview(stripExecutionEnvelope(payload.output))
      : snippet;
    return {
      kind: "output",
      label: "Output",
      text: output,
      timestamp,
      secondaryText: typeof payload.call_id === "string" ? payload.call_id : null,
    };
  }

  return {
    kind: "text",
    label: capitalizeLabel(responseType ?? "text"),
    text: snippet,
    timestamp,
    secondaryText: null,
  };
}

function buildEventPreview(
  payload: Record<string, unknown>,
  snippet: string,
  timestamp: string | null,
): SearchMatchPreview {
  if (typeof payload.message === "string") {
    const kind = payload.type === "user_message" ? "user" : "text";
    return {
      kind,
      label: kind === "user" ? "User" : "Event",
      text: payload.message,
      timestamp,
      secondaryText: typeof payload.type === "string" ? payload.type : null,
    };
  }

  return {
    kind: "text",
    label: "Event",
    text: snippet,
    timestamp,
    secondaryText: typeof payload.type === "string" ? payload.type : null,
  };
}

function extractContentText(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const texts = value
    .map((item) => isRecord(item)
      ? (typeof item.text === "string" ? item.text : null)
      : null)
    .filter((item): item is string => Boolean(item?.trim()));

  if (texts.length === 0) {
    return null;
  }

  return texts.join("\n").trim();
}

function chooseDisplayText(fullText: string | null, snippet: string): string {
  if (!fullText) {
    return snippet;
  }

  const normalized = fullText.replace(/\s+/g, " ").trim();
  if (normalized.length > 220 || isBoilerplatePreviewText(normalized)) {
    return snippet;
  }

  return normalized;
}

export function isBoilerplatePreviewText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return [
    "agents.md instructions",
    "<instructions>",
    "tools are grouped by namespace",
    "startup order",
    "working rules",
    "project-doc",
    "skills_instructions",
    "plugins_instructions",
    "collaboration mode",
    "how to use skills",
    "skill.md",
    "git workflow reference",
  ].some((pattern) => normalized.includes(pattern));
}

export function stripExecutionEnvelope(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const marker = "\nOutput:\n";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return normalized.trim();
  }

  return normalized.slice(markerIndex + marker.length).trim();
}

function normalizeRole(role: string | null): SearchMatchPreview["kind"] {
  if (role === "assistant" || role === "developer" || role === "system" || role === "user") {
    return role;
  }

  return "text";
}

function capitalizeLabel(value: string): string {
  if (!value) {
    return "Text";
  }

  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function tryParseJson(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimTextPreview(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= MAX_SNIPPET_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SNIPPET_LENGTH - 1).trim()}…`;
}
