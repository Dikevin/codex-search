import { readFile, rm } from "node:fs/promises";

import type { SearchLogRecord } from "./search-log.js";

export interface SearchHistoryEntry {
  query: string;
  normalizedQuery: string;
  count: number;
  lastUsedAt: string;
}

export async function listSearchHistory(
  logPath: string,
): Promise<SearchHistoryEntry[]> {
  const records = await readSearchHistoryRecords(logPath);
  const groups = new Map<string, SearchHistoryEntry>();

  for (const record of records) {
    if (!record.query.trim()) {
      continue;
    }

    const normalizedQuery = normalizeQuery(record.query);
    const existing = groups.get(normalizedQuery);
    if (!existing) {
      groups.set(normalizedQuery, {
        query: record.query.trim(),
        normalizedQuery,
        count: 1,
        lastUsedAt: record.endedAt,
      });
      continue;
    }

    existing.count += 1;
    if (record.endedAt >= existing.lastUsedAt) {
      existing.lastUsedAt = record.endedAt;
      existing.query = record.query.trim();
    }
  }

  return [...groups.values()]
    .sort((left, right) => (
      right.lastUsedAt.localeCompare(left.lastUsedAt)
      || right.count - left.count
      || left.query.localeCompare(right.query)
    ));
}

export async function deleteSearchHistoryEntry(
  logPath: string,
  query: string,
): Promise<boolean> {
  const records = await readSearchHistoryRecords(logPath);
  const normalizedQuery = normalizeQuery(query);
  const nextRecords = records.filter((record) => normalizeQuery(record.query) !== normalizedQuery);
  if (nextRecords.length === records.length) {
    return false;
  }

  await rewriteSearchHistory(logPath, nextRecords);
  return true;
}

export async function clearSearchHistory(logPath: string): Promise<void> {
  try {
    await rm(logPath, { force: true });
  } catch {
    // Best-effort clear.
  }
}

export function filterHistoryEntries(
  entries: SearchHistoryEntry[],
  prefix: string,
  limit: number,
): SearchHistoryEntry[] {
  const needle = normalizeQuery(prefix);
  const filtered = needle
    ? entries.filter((entry) => normalizeQuery(entry.query).includes(needle))
    : entries;
  return filtered.slice(0, limit);
}

export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

async function rewriteSearchHistory(
  logPath: string,
  records: SearchLogRecord[],
): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");

  await mkdir(dirname(logPath), { recursive: true });
  const contents = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(logPath, contents ? `${contents}\n` : "", "utf8");
}

async function readSearchHistoryRecords(
  logPath: string,
): Promise<SearchLogRecord[]> {
  try {
    const raw = await readFile(logPath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SearchLogRecord)
      .filter((record) => record.type === "search" && record.status === "completed" && record.query.trim() !== "");
  } catch {
    return [];
  }
}
