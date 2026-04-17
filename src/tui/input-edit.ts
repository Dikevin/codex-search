import { ANSI } from "./ansi.js";

export function renderInputPrompt(prefix: string, query: string, cursor: number): string {
  const clampedCursor = clamp(cursor, 0, query.length);
  const before = query.slice(0, clampedCursor);
  const current = query[clampedCursor] ?? " ";
  const after = query.slice(clampedCursor + (clampedCursor < query.length ? 1 : 0));
  return `${prefix}${before}${ANSI.inverse}${current}${ANSI.reset}${after}`;
}

export function insertText(query: string, cursor: number, text: string): { query: string; cursor: number } {
  const clampedCursor = clamp(cursor, 0, query.length);
  return {
    query: `${query.slice(0, clampedCursor)}${text}${query.slice(clampedCursor)}`,
    cursor: clampedCursor + text.length,
  };
}

export function deleteBackward(query: string, cursor: number): { query: string; cursor: number } {
  const clampedCursor = clamp(cursor, 0, query.length);
  if (clampedCursor === 0) {
    return { query, cursor: clampedCursor };
  }

  return {
    query: `${query.slice(0, clampedCursor - 1)}${query.slice(clampedCursor)}`,
    cursor: clampedCursor - 1,
  };
}

export function deleteForward(query: string, cursor: number): { query: string; cursor: number } {
  const clampedCursor = clamp(cursor, 0, query.length);
  if (clampedCursor >= query.length) {
    return { query, cursor: clampedCursor };
  }

  return {
    query: `${query.slice(0, clampedCursor)}${query.slice(clampedCursor + 1)}`,
    cursor: clampedCursor,
  };
}

export function deleteToStart(query: string, cursor: number): { query: string; cursor: number } {
  const clampedCursor = clamp(cursor, 0, query.length);
  return {
    query: query.slice(clampedCursor),
    cursor: 0,
  };
}

export function deleteToEnd(query: string, cursor: number): { query: string; cursor: number } {
  const clampedCursor = clamp(cursor, 0, query.length);
  return {
    query: query.slice(0, clampedCursor),
    cursor: clampedCursor,
  };
}

export function deleteWordBackward(query: string, cursor: number): { query: string; cursor: number } {
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

export function moveCursor(query: string, cursor: number, delta: number): { query: string; cursor: number } {
  return {
    query,
    cursor: clamp(cursor + delta, 0, query.length),
  };
}

export function moveCursorToStart(query: string): { query: string; cursor: number } {
  return {
    query,
    cursor: 0,
  };
}

export function moveCursorToEnd(query: string): { query: string; cursor: number } {
  return {
    query,
    cursor: query.length,
  };
}

export function moveCursorWordLeft(query: string, cursor: number): { query: string; cursor: number } {
  let nextCursor = clamp(cursor, 0, query.length);
  while (nextCursor > 0 && /\s/.test(query[nextCursor - 1] ?? "")) {
    nextCursor -= 1;
  }
  while (nextCursor > 0 && !/\s/.test(query[nextCursor - 1] ?? "")) {
    nextCursor -= 1;
  }
  return { query, cursor: nextCursor };
}

export function moveCursorWordRight(query: string, cursor: number): { query: string; cursor: number } {
  let nextCursor = clamp(cursor, 0, query.length);
  while (nextCursor < query.length && /\s/.test(query[nextCursor] ?? "")) {
    nextCursor += 1;
  }
  while (nextCursor < query.length && !/\s/.test(query[nextCursor] ?? "")) {
    nextCursor += 1;
  }
  return { query, cursor: nextCursor };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
