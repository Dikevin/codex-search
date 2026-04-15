import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { aggregateSearchHitsBySession, searchArchivedSessions } from "../src/search/session-reader.js";

const fixturesDir = join(import.meta.dirname, "fixtures", "codex-home");
const fixedNow = new Date("2026-04-16T12:00:00.000Z");

test("searchArchivedSessions finds matches from active and archived sources by default", async () => {
  const results = await searchArchivedSessions({
    query: "QUOTA",
    codexHomeDir: fixturesDir,
  });

  assert.equal(results.hits.length, 4);
  assert.equal(results.page, 1);
  assert.equal(results.pageSize, 5);
  assert.equal(results.offset, 0);
  assert.equal(results.hasMore, false);
  assert.equal(results.hits[0]?.sessionId, "thread-active-aaa");
  assert.equal(results.hits[0]?.source, "active");
  assert.equal(results.hits[2]?.sessionId, "thread-archived-bbb");
  assert.equal(results.hits[2]?.source, "archived");
  assert.match(results.hits[0]?.snippet ?? "", /quota drift/i);
  assert.equal(results.hits[0]?.deepLink, "codex://threads/thread-active-aaa");
  assert.equal(results.hits[0]?.resumeCommand, "codex resume thread-active-aaa");
});

test("searchArchivedSessions returns newest matches first across sessions", async () => {
  const results = await searchArchivedSessions({
    query: "release",
    codexHomeDir: fixturesDir,
  });

  assert.equal(results.hits.length, 1);
  assert.equal(results.hits[0]?.sessionId, "thread-active-ccc");
  assert.equal(results.hits[0]?.timestamp, "2026-04-16T10:00:00.000Z");
});

test("searchArchivedSessions respects case-sensitive mode", async () => {
  const results = await searchArchivedSessions({
    query: "QUOTA",
    codexHomeDir: fixturesDir,
    caseSensitive: true,
  });

  assert.equal(results.hits.length, 0);
});

test("searchArchivedSessions paginates JSON results", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    page: 1,
    pageSize: 2,
  });

  assert.equal(results.hits.length, 2);
  assert.equal(results.page, 1);
  assert.equal(results.pageSize, 2);
  assert.equal(results.offset, 0);
  assert.equal(results.hasMore, true);
});

test("searchArchivedSessions supports offset pagination", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    offset: 2,
    pageSize: 2,
    withTotal: true,
  });

  assert.equal(results.hits.length, 2);
  assert.equal(results.offset, 2);
  assert.equal(results.hasMore, false);
  assert.equal(results.total, 4);
  assert(results.hits.every((result) => result.sessionId === "thread-archived-bbb"));
});

test("searchArchivedSessions can search only active sessions", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active"],
  });

  assert.equal(results.hits.length, 2);
  assert(results.hits.every((result) => result.source === "active"));
});

test("searchArchivedSessions can search only archived sessions", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["archived"],
  });

  assert.equal(results.hits.length, 2);
  assert(results.hits.every((result) => result.source === "archived"));
});

test("searchArchivedSessions filters by recent duration", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    recent: "2d",
    now: fixedNow,
  });

  assert.equal(results.hits.length, 2);
  assert(results.hits.every((result) => result.sessionId === "thread-active-aaa"));
});

test("searchArchivedSessions filters by start and end date", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    start: "2026-04-14",
    end: "2026-04-14",
  });

  assert.equal(results.hits.length, 2);
  assert(results.hits.every((result) => result.sessionId === "thread-archived-bbb"));
});

test("aggregateSearchHitsBySession groups matches into thread summaries", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
  });

  const sessions = aggregateSearchHitsBySession(results.hits);

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]?.sessionId, "thread-active-aaa");
  assert.equal(sessions[0]?.matchCount, 2);
  assert.equal(sessions[0]?.source, "active");
  assert.equal(sessions[0]?.resumeCommand, "codex resume thread-active-aaa");
  assert.equal(sessions[0]?.deepLink, "codex://threads/thread-active-aaa");
  assert.equal(sessions[0]?.snippets.length, 2);
  assert.match(sessions[0]?.previewSnippet ?? "", /quota drift/i);

  assert.equal(sessions[1]?.sessionId, "thread-archived-bbb");
  assert.equal(sessions[1]?.matchCount, 2);
  assert.equal(sessions[1]?.source, "archived");
  assert.equal(sessions[1]?.snippets.length, 2);
});
