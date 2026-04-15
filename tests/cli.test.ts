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
