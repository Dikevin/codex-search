import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { getOpenUrlCandidates, runCli as runCliBase } from "../src/main.js";
import type { EventLogRecord } from "../src/cli/events-log.js";
import type { SearchLogRecord } from "../src/cli/search-log.js";
import { type SearchResultsPage } from "../src/search/session-reader.js";

const fixturesDir = join(import.meta.dirname, "fixtures", "codex-home");
const fixedNow = new Date("2026-04-16T12:00:00.000Z");

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

function runCli(
  argv: string[],
  options: Parameters<typeof runCliBase>[1] = {},
): Promise<number> {
  return runCliBase(argv, {
    writeSearchLog: async () => {},
    ...options,
  });
}

test("runCli uses TUI by default on a TTY", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  let invoked = false;

  const exitCode = await runCli(["quota", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: true,
    now: fixedNow,
    runTui: async ({ hitStream }) => {
      invoked = true;
      assert(hitStream);
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(invoked, true);
  assert.equal(stderr.read(), "");
});

test("runCli requires machine-readable output outside a TTY", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: false,
    now: fixedNow,
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
    now: fixedNow,
  });

  assert.equal(exitCode, 0);
  const parsed = JSON.parse(stdout.read()) as SearchResultsPage;
  assert.equal(parsed.hits.length, 2);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 2);
  assert.equal(parsed.hasMore, false);
  assert.equal(parsed.total, 2);
  assert.equal(stderr.read(), "");
});

test("runCli treats arguments after -- as a literal keyword", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["--json", "--root-dir", fixturesDir, "--", "--all"], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: false,
    now: fixedNow,
  });

  assert.equal(exitCode, 0);
  const parsed = JSON.parse(stdout.read()) as SearchResultsPage;
  assert.equal(parsed.hits.length, 0);
  assert.equal(stderr.read(), "");
});

test("runCli writes a compact search metadata log for completed searches", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  const records: SearchLogRecord[] = [];

  const exitCode = await runCli(["quota", "--json", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: false,
    now: fixedNow,
    writeSearchLog: async (_codexHomeDir, record) => {
      records.push(record);
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.type, "search");
  assert.equal(records[0]?.mode, "json");
  assert.equal(records[0]?.status, "completed");
  assert.equal(records[0]?.query, "quota");
  assert.equal(records[0]?.flags.sourceMode, "active");
  assert.equal(records[0]?.flags.view, "useful");
  assert.equal(records[0]?.results.hits, 2);
  assert.equal(records[0]?.results.threads, 1);
  assert.equal(typeof records[0]?.durationMs, "number");
  assert.equal(stderr.read(), "");
});

test("runCli writes a cancelled search metadata log when TUI stops early", async () => {
  const records: SearchLogRecord[] = [];

  const exitCode = await runCli(["quota", "--root-dir", fixturesDir], {
    isInteractiveTty: true,
    now: fixedNow,
    runTui: async ({ hitStream, cancelSearch }) => {
      for await (const _hit of hitStream ?? []) {
        cancelSearch?.();
        break;
      }
      return 0;
    },
    writeSearchLog: async (_codexHomeDir, record) => {
      records.push(record);
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.mode, "tui");
  assert.equal(records[0]?.status, "cancelled");
  assert.equal(records[0]?.results.hits, 1);
  assert.equal(records[0]?.results.threads, 1);
});

test("runCli prints JSONL search events", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--jsonl", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: false,
    now: fixedNow,
  });

  assert.equal(exitCode, 0);
  const events = stdout.read().trim().split("\n").map((line) => JSON.parse(line) as {
    type: string;
    progress?: Record<string, unknown>;
  });
  assert(events.some((event) => event.type === "progress"));
  assert(events.some((event) => event.type === "hit"));
  assert.equal("fileStates" in (events.find((event) => event.type === "progress")?.progress ?? {}), false);
  assert.equal(events.at(-1)?.type, "summary");
  assert.equal(stderr.read(), "");
});

test("runCli reports usage errors for missing keyword", async () => {
  const missingStdout = createMemoryStream();
  const missingStderr = createMemoryStream();
  const helpStdout = createMemoryStream();
  const helpStderr = createMemoryStream();

  const exitCode = await runCli([], {
    stdout: missingStdout.stream as NodeJS.WriteStream,
    stderr: missingStderr.stream as NodeJS.WriteStream,
    now: fixedNow,
  });
  const helpExitCode = await runCli(["--help"], {
    stdout: helpStdout.stream as NodeJS.WriteStream,
    stderr: helpStderr.stream as NodeJS.WriteStream,
    now: fixedNow,
  });

  assert.equal(exitCode, 1);
  assert.equal(helpExitCode, 0);
  assert.equal(missingStdout.read(), "");
  assert.equal(helpStderr.read(), "");
  assert.equal(missingStderr.read(), helpStdout.read());
});

test("runCli enters the TUI home on a TTY without a keyword", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  let invoked = false;

  const exitCode = await runCli(["--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: true,
    now: fixedNow,
    runTui: async ({ query }) => {
      invoked = true;
      assert.equal(query, "");
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(invoked, true);
  assert.equal(stdout.read(), "");
  assert.equal(stderr.read(), "");
});

test("runCli prints help with split usage lines and grouped search flags", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["--help"], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.read(), "");
  const help = stdout.read();
  assert.match(help, /Usage:\n  codexs \[search-flags\]\n  codexs <keyword>\n  codexs lucky <keyword>\n  codexs <keyword> --json \[json-flags\]\n  codexs <keyword> --jsonl\n  codexs -- <keyword-starting-with-dash>\n  codexs history \[--json\|clear\|enable\|disable\]/);
  assert.match(help, /\nShared search flags:\n/);
  assert.match(help, /--active \| --archived \| --all/);
  assert.match(help, /\nHistory:\n/);
});

test("runCli lists, disables, enables, and clears search history", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "codexs-history-"));
  await mkdir(join(rootDir, "logs", "codex-search"), { recursive: true });
  await writeFile(join(rootDir, "logs", "codex-search", "searches.jsonl"), [
    JSON.stringify({
      version: 1,
      type: "search",
      startedAt: "2026-04-16T01:00:00.000Z",
      endedAt: "2026-04-16T01:00:01.000Z",
      durationMs: 1000,
      mode: "json",
      status: "completed",
      exitCode: 0,
      query: "quota",
      flags: {
        sourceMode: "active",
        sources: ["active"],
        view: "useful",
        caseSensitive: false,
        cwd: null,
        recent: "30d",
        start: null,
        end: null,
        allTime: false,
        json: true,
        jsonl: false,
        page: 1,
        pageSize: 5,
        offset: 0,
        withTotal: false,
      },
      results: {
        hits: 1,
        threads: 1,
      },
      progress: null,
    } satisfies SearchLogRecord),
  ].join("\n"), "utf8");

  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  const events: EventLogRecord[] = [];

  const listExitCode = await runCli(["history", "--root-dir", rootDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
    writeEventLog: async (_root, record) => {
      events.push(record);
    },
  });

  assert.equal(listExitCode, 0);
  assert.match(stdout.read(), /quota/);
  assert.equal(stderr.read(), "");

  const disableStdout = createMemoryStream();
  const disableExitCode = await runCli(["history", "disable", "--root-dir", rootDir], {
    stdout: disableStdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
    writeEventLog: async (_root, record) => {
      events.push(record);
    },
  });
  assert.equal(disableExitCode, 0);
  assert.match(disableStdout.read(), /Disabled search history/);

  const disabledStdout = createMemoryStream();
  const disabledExitCode = await runCli(["history", "--root-dir", rootDir], {
    stdout: disabledStdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
    writeEventLog: async (_root, record) => {
      events.push(record);
    },
  });
  assert.equal(disabledExitCode, 0);
  assert.match(disabledStdout.read(), /Search history is disabled/);

  const enableStdout = createMemoryStream();
  const enableExitCode = await runCli(["history", "enable", "--root-dir", rootDir], {
    stdout: enableStdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
    writeEventLog: async (_root, record) => {
      events.push(record);
    },
  });
  assert.equal(enableExitCode, 0);
  assert.match(enableStdout.read(), /Enabled search history/);

  const clearStdout = createMemoryStream();
  const clearExitCode = await runCli(["history", "clear", "--root-dir", rootDir], {
    stdout: clearStdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
    writeEventLog: async (_root, record) => {
      events.push(record);
    },
  });
  assert.equal(clearExitCode, 0);
  assert.match(clearStdout.read(), /Cleared search history/);

  assert.deepEqual(events.map((event) => event.event), [
    "history_disabled",
    "history_enabled",
    "history_clear",
  ]);
});

test("runCli suggests corrections for unknown flags", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--jsno"], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.read(), "");
  assert.equal(
    stderr.read(),
    'Error: Unknown flag "--jsno".\nDid you mean "--json"?\n',
  );
});

test("runCli suggests corrections for mistyped commands", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["lukcy", "quota"], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.read(), "");
  assert.equal(
    stderr.read(),
    'Error: Unknown command "lukcy".\nDid you mean "lucky"?\n',
  );
});

test("runCli lucky opens the newest matching thread deeplink", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  const opened: string[] = [];

  const exitCode = await runCli(["lucky", "release", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
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
    now: fixedNow,
    openUrl: async (url) => {
      opened.push(url);
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(opened, []);
  assert.equal(stdout.read(), "");
  assert.match(stderr.read(), /No matches found/);
});

test("runCli lucky does not open archived threads", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();
  const opened: string[] = [];

  const exitCode = await runCli(["lucky", "quota", "--archived", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    openUrl: async (url) => {
      opened.push(url);
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(opened, []);
  assert.equal(stdout.read(), "");
  assert.match(stderr.read(), /Archived thread cannot be reopened directly/);
  assert.match(stderr.read(), /thread-archived-bbb/);
});

test("runCli passes a hit stream to the default TUI", async () => {
  let streamed = 0;

  const exitCode = await runCli(["quota", "--root-dir", fixturesDir], {
    isInteractiveTty: true,
    now: fixedNow,
    runTui: async (options) => {
      for await (const hit of options.hitStream ?? []) {
        streamed += 1;
        assert.match(hit.sessionId, /thread-/);
        break;
      }
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(streamed, 1);
});

test("runCli can restrict search to active sessions", async () => {
  const sources: string[] = [];

  const exitCode = await runCli(["quota", "--active", "--root-dir", fixturesDir], {
    isInteractiveTty: true,
    now: fixedNow,
    runTui: async (options) => {
      for await (const hit of options.hitStream ?? []) {
        sources.push(hit.source);
      }
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(new Set(sources), new Set(["active"]));
});

test("runCli can search all sources explicitly", async () => {
  const sources: string[] = [];

  const exitCode = await runCli(["quota", "--all", "--root-dir", fixturesDir], {
    isInteractiveTty: true,
    now: fixedNow,
    runTui: async (options) => {
      for await (const hit of options.hitStream ?? []) {
        sources.push(hit.source);
      }
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(new Set(sources), new Set(["active", "archived"]));
});

test("runCli can filter by cwd", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--json", "-D", "/tmp/project-active-a", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: false,
    now: fixedNow,
  });

  assert.equal(exitCode, 0);
  const parsed = JSON.parse(stdout.read()) as SearchResultsPage;
  assert.equal(parsed.hits.length, 2);
  assert(parsed.hits.every((hit) => hit.sessionId === "thread-active-aaa"));
});

test("runCli rejects pagination flags in interactive mode", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "-n", "2", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: true,
    now: fixedNow,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /Interactive mode does not support/);
});

test("runCli rejects pagination flags in JSONL mode", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["quota", "--jsonl", "-n", "2", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: false,
    now: fixedNow,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /JSONL mode does not support/);
});

test("runCli rejects JSON flags in lucky mode", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["lucky", "quota", "--json", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /Lucky mode does not support/);
});

test("runCli supports --all-time to search outside the default recent window", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const defaultExitCode = await runCli(["old quota", "--json", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    isInteractiveTty: false,
    now: fixedNow,
  });
  const defaultParsed = JSON.parse(stdout.read()) as SearchResultsPage;

  assert.equal(defaultExitCode, 0);
  assert.equal(defaultParsed.hits.length, 0);

  const allTimeStdout = createMemoryStream();
  const allTimeStderr = createMemoryStream();
  const allTimeExitCode = await runCli(["old quota", "--json", "--all-time", "--root-dir", fixturesDir], {
    stdout: allTimeStdout.stream as NodeJS.WriteStream,
    stderr: allTimeStderr.stream as NodeJS.WriteStream,
    isInteractiveTty: false,
    now: fixedNow,
  });
  const allTimeParsed = JSON.parse(allTimeStdout.read()) as SearchResultsPage;

  assert.equal(allTimeExitCode, 0);
  assert.equal(allTimeParsed.hits.length, 1);
  assert.equal(allTimeParsed.hits[0]?.sessionId, "thread-old-ddd");
  assert.equal(stderr.read(), "");
  assert.equal(allTimeStderr.read(), "");
});

test("getOpenUrlCandidates prefers platform-appropriate openers", () => {
  assert.deepEqual(getOpenUrlCandidates("darwin", {}), [["open"]]);
  assert.deepEqual(getOpenUrlCandidates("linux", {}), [["xdg-open"]]);
  assert.deepEqual(getOpenUrlCandidates("linux", { WSL_DISTRO_NAME: "Ubuntu" }), [["wslview"], ["xdg-open"]]);
  assert.deepEqual(getOpenUrlCandidates("linux", { WSL_INTEROP: "/run/WSL" }), [["wslview"], ["xdg-open"]]);
});

test("runCli prints recorded cwd values for shell completion", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["completion", "--cwds", "--root-dir", fixturesDir], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout.read().trim().split("\n"), [
    "/tmp/project-active-a",
    "/tmp/project-active-c",
    "/tmp/project-archived-b",
    "/tmp/project-old-d",
  ]);
  assert.equal(stderr.read(), "");
});

test("runCli rejects invalid completion target", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["completion", "fish"], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /codexs completion <zsh\|bash>/);
});

test("runCli rejects unexpected arguments for cwd completion", async () => {
  const stdout = createMemoryStream();
  const stderr = createMemoryStream();

  const exitCode = await runCli(["completion", "--cwds", "extra"], {
    stdout: stdout.stream as NodeJS.WriteStream,
    stderr: stderr.stream as NodeJS.WriteStream,
    now: fixedNow,
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.read(), /codexs completion --cwds/);
});
