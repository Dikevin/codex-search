import { ANSI } from "./ansi.js";

const ANSI_PATTERN = /\u001B\[[0-9;?]*[A-Za-z]/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function sanitizeInlineText(value: string): string {
  return sanitizeBlockText(value)
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeBlockText(value: string): string {
  const normalized = stripAnsi(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(CONTROL_PATTERN, "");

  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));

  const collapsed: string[] = [];
  let previousBlank = false;
  for (const line of lines) {
    const isBlank = line.trim() === "";
    if (isBlank && previousBlank) {
      continue;
    }

    collapsed.push(line);
    previousBlank = isBlank;
  }

  return collapsed.join("\n").trim();
}

export function displayWidth(value: string): number {
  let width = 0;

  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (
      codePoint === 0 ||
      (codePoint >= 0x0300 && codePoint <= 0x036f) ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    ) {
      continue;
    }

    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }

  return width;
}

export function truncatePlain(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  if (displayWidth(value) <= width) {
    return value;
  }

  if (width === 1) {
    return "…";
  }

  let result = "";
  let used = 0;
  const target = width - 1;

  for (const char of value) {
    const charWidth = displayWidth(char);
    if (used + charWidth > target) {
      break;
    }

    result += char;
    used += charWidth;
  }

  return `${result}…`;
}

export function wrapPlain(value: string, width: number): string[] {
  if (width <= 0) {
    return [];
  }

  const lines: string[] = [];
  let current = "";
  let used = 0;

  for (const char of value) {
    const charWidth = displayWidth(char);
    if (used + charWidth > width) {
      lines.push(current);
      current = char;
      used = charWidth;
      continue;
    }

    current += char;
    used += charWidth;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

export function wrapBlock(value: string, width: number): string[] {
  const sanitized = sanitizeBlockText(value);
  if (!sanitized) {
    return [""];
  }

  return sanitized
    .split("\n")
    .flatMap((line) => line === "" ? [""] : wrapPlain(line, width));
}

export function truncate(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  const plain = stripAnsi(value);
  if (displayWidth(plain) <= width) {
    return value;
  }

  if (width === 1) {
    return "…";
  }

  const target = width - 1;
  let output = "";
  let used = 0;
  let cursor = 0;

  while (cursor < value.length && used < target) {
    const escapeMatch = /^\u001B\[[0-9;?]*[A-Za-z]/.exec(value.slice(cursor));
    if (escapeMatch) {
      output += escapeMatch[0];
      cursor += escapeMatch[0].length;
      continue;
    }

    const char = value[cursor] ?? "";
    const charWidth = displayWidth(char);
    if (used + charWidth > target) {
      break;
    }

    output += char;
    used += charWidth;
    cursor += 1;
  }

  return `${output}…${output.includes("\u001B[") ? ANSI.reset : ""}`;
}

export function padAnsi(value: string, width: number): string {
  const plainWidth = displayWidth(stripAnsi(value));
  if (plainWidth >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - plainWidth)}`;
}

export function padDisplay(value: string, width: number): string {
  const trimmed = truncatePlain(value, width);
  const remaining = Math.max(0, width - displayWidth(trimmed));
  return `${trimmed}${" ".repeat(remaining)}`;
}

export function highlightText(
  value: string,
  query: string,
  caseSensitive: boolean,
  resumeStyle = "",
): string {
  if (!value || !query) {
    return value;
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  const haystack = caseSensitive ? value : value.toLowerCase();
  if (!needle || !haystack.includes(needle)) {
    return value;
  }

  let cursor = 0;
  let output = "";
  while (cursor < value.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) {
      output += value.slice(cursor);
      break;
    }

    output += value.slice(cursor, index);
    output += `${ANSI.bold}${ANSI.underline}${value.slice(index, index + query.length)}${ANSI.reset}${resumeStyle}`;
    cursor = index + query.length;
  }

  return output;
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}
