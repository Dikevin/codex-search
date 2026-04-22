import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import packageJson from "../package.json" with { type: "json" };
import {
  appendEventLog,
  getEventLogPath,
} from "../src/cli/events-log.js";
import {
  appendSearchLog,
  getSearchLogPath,
} from "../src/cli/search-log.js";

test("structured logs include the running codexs version", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "codexs-logs-"));

  try {
    await appendSearchLog(codexHome, {
      version: 1,
      codexsVersion: "stale",
      type: "search",
      startedAt: "2026-04-22T00:00:00.000Z",
      endedAt: "2026-04-22T00:00:01.000Z",
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
        pageSize: 10,
        offset: 0,
        withTotal: false,
      },
      results: {
        hits: 1,
        threads: 1,
      },
      progress: null,
    });
    await appendEventLog(codexHome, {
      version: 1,
      codexsVersion: "stale",
      type: "event",
      time: "2026-04-22T00:00:01.000Z",
      severity: "info",
      event: "search_run",
      mode: "json",
      query: "quota",
    });

    const [searchLog] = (await readFile(getSearchLogPath(codexHome), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const [eventLog] = (await readFile(getEventLogPath(codexHome), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    assert.equal(searchLog?.codexsVersion, packageJson.version);
    assert.equal(eventLog?.codexsVersion, packageJson.version);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
