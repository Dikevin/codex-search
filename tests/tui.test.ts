import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { searchArchivedSessions } from "../src/search/session-reader.js";
import {
  createInitialTuiState,
  renderSearchTuiScreen,
  toggleExpandedSelection,
} from "../src/tui/index.js";

const fixturesDir = join(import.meta.dirname, "fixtures", "codex-home");

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");
}

test("renderSearchTuiScreen shows thread-level rows by default", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
  });

  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: createInitialTuiState(),
    width: 120,
    height: 24,
  }));

  assert.match(screen, /thread-active-aaa/);
  assert.match(screen, /2 matches/);
  assert.doesNotMatch(screen, /resume:/);
  assert.doesNotMatch(screen, /open:/);
});

test("renderSearchTuiScreen expands the selected thread details inline", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
  });

  const state = toggleExpandedSelection(createInitialTuiState(), results.hits);
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state,
    width: 140,
    height: 28,
  }));

  assert.match(screen, /cwd:/);
  assert.match(screen, /open: codex:\/\/threads\/thread-active-aaa/);
  assert.match(screen, /resume: codex resume thread-active-aaa/);
  assert.match(screen, /1\. .*quota drift/i);
  assert.match(screen, /2\. .*quota drift/i);
  assert.match(screen, /Space/);
});
