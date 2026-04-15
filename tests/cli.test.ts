import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { join } from "node:path";

import { runCli } from "../src/main.js";
import { type SearchResultsPage } from "../src/search/session-reader.js";

const fixturesDir = join(import.meta.dirname, "fixtures", "codex-home");

function createMemoryStream() {
  let text = "";
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        text += chunk.toString();
        callback();
      },
    }),
    read() {
      return text;
    },
  };
}

test("runCli uses TUI by default on a TTY", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  let invoked = false;
  let capturedResults: SearchResultsPage | null = null;

  const exitCode = await runCli(["quota", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: true,
    runTui: async ({ results }) => {
      invoked = true;
      capturedResults = results;
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(invoked, true);
  assert.equal(capturedResults?.hits.length, 4);
  assert.equal(stderr.read(), "");
});

test("runCli requires --json outside a TTY", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: false,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /Use --json/);
});

test("runCli prints JSON search results", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--json", "--page", "1", "--page-size", "2", "--with-total", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: false,
  });

  assert.equal(exitCode, 0);
  const parsed = JSON.parse(stdout.read()) as SearchResultsPage;
  assert.equal(parsed.hits.length, 2);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 2);
  assert.equal(parsed.hasMore, true);
  assert.equal(parsed.total, 4);
  assert.equal(stderr.read(), "");
});

test("runCli reports usage errors for missing keyword", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli([], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /codexs <keyword>/);
});

test("runCli lucky opens the newest matching thread deeplink", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  const opened: string[] = [];

  const exitCode = await runCli(["lucky", "release", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    openUrl: async (url) => {
      opened.push(url);
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(opened, ["codex://threads/thread-active-ccc"]);
  assert.match(stdout.read(), /Opened codex:\/\/threads\/thread-active-ccc/);
  assert.equal(stderr.read(), "");
});

test("runCli lucky reports when nothing matches", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  const opened: string[] = [];

  const exitCode = await runCli(["lucky", "missing", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    openUrl: async (url) => {
      opened.push(url);
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(opened, []);
  assert.equal(stdout.read(), "");
  assert.match(stderr.read(), /No matches found/);
});

test("runCli can restrict search to active sessions", async () => {
  let results: SearchResultsPage | null = null;

  const exitCode = await runCli(["quota", "--active", "--root-dir", fixturesDir], {
    isInteractiveTty: true,
    runTui: async (options) => {
      results = options.results;
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert(results);
  assert(results.hits.every((hit) => hit.source === "active"));
});

test("runCli rejects pagination flags in interactive mode", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "-n", "2", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: true,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /Interactive mode does not support/);
});

test("runCli rejects JSON flags in lucky mode", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["lucky", "quota", "--json", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /Lucky mode does not support/);
});
