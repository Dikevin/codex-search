import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { searchArchivedSessions } from "../src/search/session-reader.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

test("searchArchivedSessions finds matches case-insensitively by default", async () => {
  const results = await searchArchivedSessions({
    query: "QUOTA",
    rootDir: fixturesDir,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0]?.sessionId, "thread-aaa");
  assert.equal(results[1]?.sessionId, "thread-aaa");
  assert.match(results[0]?.snippet ?? "", /quota drift/i);
  assert.equal(results[0]?.deepLink, "codex://threads/thread-aaa");
  assert.equal(results[0]?.resumeCommand, "codex resume thread-aaa");
});

test("searchArchivedSessions returns newest matches first across sessions", async () => {
  const results = await searchArchivedSessions({
    query: "release",
    rootDir: fixturesDir,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.sessionId, "thread-bbb");
  assert.equal(results[0]?.timestamp, "2026-04-16T10:00:00.000Z");
});

test("searchArchivedSessions respects case-sensitive mode", async () => {
  const results = await searchArchivedSessions({
    query: "QUOTA",
    rootDir: fixturesDir,
    caseSensitive: true,
  });

  assert.equal(results.length, 0);
});

test("searchArchivedSessions respects result limits", async () => {
  const results = await searchArchivedSessions({
    query: "drift",
    rootDir: fixturesDir,
    limit: 1,
  });

  assert.equal(results.length, 1);
});
