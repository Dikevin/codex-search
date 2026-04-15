import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { join } from "node:path";

import { runCli } from "../src/main.js";

const fixturesDir = join(import.meta.dirname, "fixtures");

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
  assert.match(stdout.read(), /thread-aaa/);
  assert.match(stdout.read(), /codex:\/\/threads\/thread-aaa/);
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
  assert.deepEqual(opened, ["codex://threads/thread-bbb"]);
  assert.match(stdout.read(), /Opened codex:\/\/threads\/thread-bbb/);
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
