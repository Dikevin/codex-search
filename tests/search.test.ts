import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { searchArchivedSessions } from "../src/search/session-reader.js";

const fixturesDir = join(import.meta.dirname, "fixtures", "codex-home");
const fixedNow = new Date("2026-04-16T12:00:00.000Z");

test("searchArchivedSessions finds matches from active and archived sources by default", async () => {
  const results = await searchArchivedSessions({
    query: "QUOTA",
    codexHomeDir: fixturesDir,
  });

  assert.equal(results.length, 4);
  assert.equal(results[0]?.sessionId, "thread-active-aaa");
  assert.equal(results[0]?.source, "active");
  assert.equal(results[2]?.sessionId, "thread-archived-bbb");
  assert.equal(results[2]?.source, "archived");
  assert.match(results[0]?.snippet ?? "", /quota drift/i);
  assert.equal(results[0]?.deepLink, "codex://threads/thread-active-aaa");
  assert.equal(results[0]?.resumeCommand, "codex resume thread-active-aaa");
});

test("searchArchivedSessions returns newest matches first across sessions", async () => {
  const results = await searchArchivedSessions({
    query: "release",
    codexHomeDir: fixturesDir,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.sessionId, "thread-active-ccc");
  assert.equal(results[0]?.timestamp, "2026-04-16T10:00:00.000Z");
});

test("searchArchivedSessions respects case-sensitive mode", async () => {
  const results = await searchArchivedSessions({
    query: "QUOTA",
    codexHomeDir: fixturesDir,
    caseSensitive: true,
  });

  assert.equal(results.length, 0);
});

test("searchArchivedSessions respects result limits", async () => {
  const results = await searchArchivedSessions({
    query: "drift",
    codexHomeDir: fixturesDir,
    limit: 1,
  });

  assert.equal(results.length, 1);
});

test("searchArchivedSessions can search only active sessions", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active"],
  });

  assert.equal(results.length, 2);
  assert(results.every((result) => result.source === "active"));
});

test("searchArchivedSessions can search only archived sessions", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["archived"],
  });

  assert.equal(results.length, 2);
  assert(results.every((result) => result.source === "archived"));
});

test("searchArchivedSessions filters by recent duration", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    recent: "2d",
    now: fixedNow,
  });

  assert.equal(results.length, 2);
  assert(results.every((result) => result.sessionId === "thread-active-aaa"));
});

test("searchArchivedSessions filters by start and end date", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    start: "2026-04-14",
    end: "2026-04-14",
  });

  assert.equal(results.length, 2);
  assert(results.every((result) => result.sessionId === "thread-archived-bbb"));
});
