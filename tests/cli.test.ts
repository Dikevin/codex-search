import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { join } from "node:path";

import { runCli } from "../src/main.js";

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

test("runCli prints human-readable search results", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
  });

  assert.equal(exitCode, 0);
  const output = stdout.read();
  assert.match(output, /1\. 2026-04-15 10:00/);
  assert.match(output, /\[active\]/);
  assert.match(output, /thread-active-aaa/);
  assert.match(output, /resume: codex resume thread-active-aaa/);
  assert.match(output, /open:\s+codex:\/\/threads\/thread-active-aaa/);
  assert.doesNotMatch(output, /file:/);
  assert.equal(stderr.read(), "");
});

test("runCli prints JSON search results", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--json", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
  });

  assert.equal(exitCode, 0);
  assert.doesNotThrow(() => JSON.parse(stdout.read()));
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
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--active", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
  });

  assert.equal(exitCode, 0);
  const output = stdout.read();
  assert.match(output, /\[active\]/);
  assert.doesNotMatch(output, /\[archived\]/);
  assert.equal(stderr.read(), "");
});

test("runCli can restrict search to archived sessions", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--archived", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
  });

  assert.equal(exitCode, 0);
  const output = stdout.read();
  assert.match(output, /\[archived\]/);
  assert.doesNotMatch(output, /\[active\]/);
  assert.equal(stderr.read(), "");
});

test("runCli can filter by recent duration", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--recent", "2d", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: new Date("2026-04-16T12:00:00.000Z"),
  });

  assert.equal(exitCode, 0);
  const output = stdout.read();
  assert.match(output, /thread-active-aaa/);
  assert.doesNotMatch(output, /thread-archived-bbb/);
  assert.equal(stderr.read(), "");
});
