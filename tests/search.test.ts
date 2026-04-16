import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { aggregateSearchHitsBySession, listRecordedCwds, searchArchivedSessions, streamSearchHits } from "../src/search/session-reader.js";
import { searchSessionFileHitsWithReporter, type SearchFileEntry } from "../src/search/session-file-search.js";

const fixturesDir = join(import.meta.dirname, "fixtures", "codex-home");
const fixedNow = new Date("2026-04-16T12:00:00.000Z");

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function writeSessionFixture(options: {
  filePath: string;
  sessionId: string;
  timestamp: string;
  cwd: string;
  messages: string[];
  messageTimestamps?: string[];
  leadingFillerLines?: number;
  fillerLines?: number;
}): Promise<void> {
  await mkdir(dirname(options.filePath), { recursive: true });

  const leadingFillerLines = options.leadingFillerLines ?? 0;
  const makeFillerLine = (index: number, offset: number) => JSON.stringify({
    timestamp: new Date(
      Date.parse(options.timestamp) + ((offset + index + 1) * 60_000),
    ).toISOString(),
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: `non-matching filler line ${offset + index} ${"x".repeat(120)}`,
        },
      ],
    },
  });

  const lines = [
    JSON.stringify({
      timestamp: options.timestamp,
      type: "session_meta",
      payload: {
        id: options.sessionId,
        timestamp: options.timestamp,
        cwd: options.cwd,
        originator: "Codex Desktop",
      },
    }),
    ...Array.from(
      { length: leadingFillerLines },
      (_, index) => makeFillerLine(index, 0),
    ),
    ...options.messages.map((text, index) => JSON.stringify({
      timestamp: options.messageTimestamps?.[index]
        ?? new Date(
          Date.parse(options.timestamp) + ((leadingFillerLines + index + 1) * 60_000),
        ).toISOString(),
      type: "response_item",
      payload: {
        type: "message",
        role: index % 2 === 0 ? "user" : "assistant",
        content: [
          {
            type: index % 2 === 0 ? "input_text" : "output_text",
            text,
          },
        ],
      },
    })),
  ];

  for (let index = 0; index < (options.fillerLines ?? 0); index += 1) {
    lines.push(makeFillerLine(index, leadingFillerLines + options.messages.length));
  }

  await writeFile(options.filePath, `${lines.join("\n")}\n`);
}

test("searchArchivedSessions finds matches from active sources by default", async () => {
  const results = await searchArchivedSessions({
    query: "QUOTA",
    codexHomeDir: fixturesDir,
    now: fixedNow,
  });

  assert.equal(results.hits.length, 2);
  assert.equal(results.page, 1);
  assert.equal(results.pageSize, 5);
  assert.equal(results.offset, 0);
  assert.equal(results.hasMore, false);
  assert.equal(results.hits[0]?.sessionId, "thread-active-aaa");
  assert.equal(results.hits[0]?.source, "active");
  assert.match(results.hits[0]?.snippet ?? "", /quota drift/i);
  assert.equal(results.hits[0]?.deepLink, "codex://threads/thread-active-aaa");
  assert.equal(results.hits[0]?.resumeCommand, "codex resume thread-active-aaa");
});

test("searchArchivedSessions can search active and archived sources explicitly", async () => {
  const results = await searchArchivedSessions({
    query: "QUOTA",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
  });

  assert.equal(results.hits.length, 4);
  assert.equal(results.hits[0]?.source, "active");
  assert.equal(results.hits[2]?.sessionId, "thread-archived-bbb");
  assert.equal(results.hits[2]?.source, "archived");
});

test("searchArchivedSessions returns newest matches first across sessions", async () => {
  const results = await searchArchivedSessions({
    query: "release",
    codexHomeDir: fixturesDir,
    now: fixedNow,
  });

  assert.equal(results.hits.length, 1);
  assert.equal(results.hits[0]?.sessionId, "thread-active-ccc");
  assert.equal(results.hits[0]?.timestamp, "2026-04-16T10:01:00.000Z");
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
    sources: ["active", "archived"],
    page: 1,
    pageSize: 2,
    now: fixedNow,
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
    sources: ["active", "archived"],
    offset: 2,
    pageSize: 2,
    withTotal: true,
    now: fixedNow,
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
    now: fixedNow,
  });

  assert.equal(results.hits.length, 2);
  assert(results.hits.every((result) => result.source === "active"));
});

test("searchArchivedSessions can search only archived sessions", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["archived"],
    now: fixedNow,
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

test("searchArchivedSessions filters matching lines by their own timestamps", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "codexs-line-time-"));
  const sessionPath = join(
    tempHome,
    "sessions",
    "2026",
    "04",
    "15",
    "rollout-2026-04-15T10-00-00-thread-line-time.jsonl",
  );

  await writeSessionFixture({
    filePath: sessionPath,
    sessionId: "thread-line-time",
    timestamp: "2026-04-15T10:00:00.000Z",
    cwd: "/tmp/line-time",
    messages: [
      "quota from an old line",
      "quota from a recent line",
    ],
    messageTimestamps: [
      "2026-03-01T10:00:00.000Z",
      "2026-04-15T10:02:00.000Z",
    ],
  });

  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: tempHome,
    recent: "2d",
    now: fixedNow,
  });

  assert.equal(results.hits.length, 1);
  assert.equal(results.hits[0]?.sessionId, "thread-line-time");
  assert.match(results.hits[0]?.snippet ?? "", /recent line/);
});

test("searchArchivedSessions keeps recently updated sessions even when the file path is older", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "codexs-old-path-recent-hit-"));
  const sessionPath = join(
    tempHome,
    "sessions",
    "2026",
    "03",
    "01",
    "rollout-2026-03-01T10-00-00-thread-old-path.jsonl",
  );

  await writeSessionFixture({
    filePath: sessionPath,
    sessionId: "thread-old-path",
    timestamp: "2026-03-01T10:00:00.000Z",
    cwd: "/tmp/old-path",
    messages: [
      "quota from a recently updated thread",
    ],
    messageTimestamps: [
      "2026-04-15T10:02:00.000Z",
    ],
  });
  await utimes(
    sessionPath,
    new Date("2026-04-15T10:02:00.000Z"),
    new Date("2026-04-15T10:02:00.000Z"),
  );

  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: tempHome,
    recent: "2d",
    now: fixedNow,
  });

  assert.equal(results.hits.length, 1);
  assert.equal(results.hits[0]?.sessionId, "thread-old-path");
  assert.equal(results.hits[0]?.timestamp, "2026-04-15T10:02:00.000Z");
});

test("searchArchivedSessions filters by start and end date", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["archived"],
    start: "2026-04-14",
    end: "2026-04-14",
  });

  assert.equal(results.hits.length, 2);
  assert(results.hits.every((result) => result.sessionId === "thread-archived-bbb"));
});

test("searchArchivedSessions filters by cwd prefix", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    cwd: "/tmp/project-active-a",
    now: fixedNow,
  });

  assert.equal(results.hits.length, 2);
  assert(results.hits.every((result) => result.sessionId === "thread-active-aaa"));
});

test("searchArchivedSessions defaults to the useful view and filters protocol noise", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "codexs-view-filter-"));
  const sessionPath = join(
    tempHome,
    "sessions",
    "2026",
    "04",
    "15",
    "rollout-2026-04-15T10-00-00-thread-view-filter.jsonl",
  );

  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, [
    JSON.stringify({
      timestamp: "2026-04-15T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "thread-view-filter",
        timestamp: "2026-04-15T10:00:00.000Z",
        cwd: "/tmp/view-filter",
        originator: "Codex Desktop",
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-15T10:01:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "byte_quota user question" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-15T10:02:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "byte_quota assistant answer" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-15T10:03:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "byte_quota developer protocol" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-15T10:04:00.000Z",
      type: "response_item",
      payload: {
        type: "command",
        command: "git status byte_quota",
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-15T10:05:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        output: "Chunk ID: abc\nWall time: 0.1 seconds\nOutput:\nbyte_quota useful output",
        call_id: "call-view-filter",
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-15T10:06:00.000Z",
      type: "response_item",
      payload: {
        tool: "exec_command",
        arguments: "{\"cmd\":\"git status byte_quota\"}",
      },
    }),
    JSON.stringify({
      timestamp: "2026-04-15T10:07:00.000Z",
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "byte_quota duplicate agent message",
      },
    }),
  ].join("\n"));

  const useful = await searchArchivedSessions({
    query: "byte_quota",
    codexHomeDir: tempHome,
    allTime: true,
  });
  const ops = await searchArchivedSessions({
    query: "byte_quota",
    codexHomeDir: tempHome,
    allTime: true,
    view: "ops",
  });
  const protocol = await searchArchivedSessions({
    query: "byte_quota",
    codexHomeDir: tempHome,
    allTime: true,
    view: "protocol",
  });
  const all = await searchArchivedSessions({
    query: "byte_quota",
    codexHomeDir: tempHome,
    allTime: true,
    view: "all",
    pageSize: 10,
  });

  assert.deepEqual(useful.hits.map((hit) => hit.preview.kind), ["output", "command", "assistant", "user"]);
  assert.match(useful.hits[0]?.preview.text ?? "", /byte_quota useful output/);
  assert.equal(ops.hits.some((hit) => hit.preview.kind === "tool"), true);
  assert.equal(protocol.hits.length, 1);
  assert.equal(protocol.hits[0]?.preview.kind, "developer");
  assert.equal(all.hits.length, 7);
});

test("listRecordedCwds returns unique recorded cwd values", async () => {
  const cwdValues = await listRecordedCwds({
    codexHomeDir: fixturesDir,
    allTime: true,
    now: fixedNow,
  });

  assert.deepEqual(cwdValues, [
    "/tmp/project-active-a",
    "/tmp/project-active-c",
    "/tmp/project-archived-b",
    "/tmp/project-old-d",
  ]);
});

test("listRecordedCwds reflects cwd changes without a persistent cache", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "codexs-cwd-values-"));
  await cp(fixturesDir, tempHome, { recursive: true });

  const firstValues = await listRecordedCwds({
    codexHomeDir: tempHome,
    allTime: true,
    now: fixedNow,
  });
  assert(firstValues.includes("/tmp/project-active-a"));

  const activeSessionPath = join(
    tempHome,
    "sessions",
    "2026",
    "04",
    "15",
    "rollout-2026-04-15T10-00-00-thread-active-aaa.jsonl",
  );
  const original = await readFile(activeSessionPath, "utf8");
  await writeFile(activeSessionPath, original.replace("/tmp/project-active-a", "/tmp/project-active-renamed"));

  const secondValues = await listRecordedCwds({
    codexHomeDir: tempHome,
    allTime: true,
    now: fixedNow,
  });

  assert(secondValues.includes("/tmp/project-active-renamed"));
  assert(!secondValues.includes("/tmp/project-active-a"));
});

test("searchSessionFileHitsWithReporter streams first and subsequent matches in chunks", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "codexs-chunk-report-"));
  const sessionPath = join(
    tempHome,
    "sessions",
    "2026",
    "04",
    "16",
    "rollout-2026-04-16T10-00-00-thread-chunked.jsonl",
  );

  await writeSessionFixture({
    filePath: sessionPath,
    sessionId: "thread-chunked",
    timestamp: "2026-04-16T10:00:00.000Z",
    cwd: "/tmp/chunked",
    messages: Array.from({ length: 18 }, (_, index) => `quota chunk ${index + 1}`),
  });

  const fileEntry: SearchFileEntry = {
    filePath: sessionPath,
    mtimeMs: Date.now(),
    size: (await readFile(sessionPath)).byteLength,
  };
  const chunks: string[][] = [];

  const finalHits = await searchSessionFileHitsWithReporter(
    fileEntry,
    {
      query: "quota",
      cwd: null,
      caseSensitive: false,
      source: "active",
      timeRange: null,
      mode: "stream",
    },
    (hits) => {
      chunks.push(hits.map((hit) => hit.snippet));
    },
  );

  assert.equal(finalHits.hits.length, 0);
  assert.equal(finalHits.sessionSummary?.sessionId, "thread-chunked");
  assert.equal(finalHits.sessionSummary?.messageCount, 18);
  assert(chunks.length >= 2);
  assert.equal(chunks.flat().length, 18);
});

test("aggregateSearchHitsBySession groups matches into thread summaries", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
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

test("aggregateSearchHitsBySession downranks boilerplate previews", () => {
  const sessions = aggregateSearchHitsBySession([
    {
      sessionId: "thread-1",
      timestamp: "2026-04-16T10:00:00.000Z",
      cwd: "/tmp/project-1",
      title: "Thread 1",
      snippet: "quota drift in billing summary",
      preview: {
        kind: "user",
        label: "User",
        text: "# AGENTS.md instructions for /Users/bytedance/Documents/projects/chat",
        timestamp: "2026-04-16T10:00:00.000Z",
        secondaryText: null,
      },
      source: "active",
      filePath: "/tmp/thread-1.jsonl",
      resumeCommand: "codex resume thread-1",
      deepLink: "codex://threads/thread-1",
    },
    {
      sessionId: "thread-1",
      timestamp: "2026-04-16T10:01:00.000Z",
      cwd: "/tmp/project-1",
      title: "Thread 1",
      snippet: "quota drift in billing summary",
      preview: {
        kind: "assistant",
        label: "Assistant",
        text: "I found quota drift in the billing summary.",
        timestamp: "2026-04-16T10:01:00.000Z",
        secondaryText: null,
      },
      source: "active",
      filePath: "/tmp/thread-1.jsonl",
      resumeCommand: "codex resume thread-1",
      deepLink: "codex://threads/thread-1",
    },
  ]);

  assert.equal(sessions[0]?.previewSnippet, "I found quota drift in the billing summary.");
});

test("streamSearchHits yields matching sessions incrementally", async () => {
  const hits: string[] = [];

  for await (const hit of streamSearchHits({
    query: "quota",
    codexHomeDir: fixturesDir,
    now: fixedNow,
  })) {
    hits.push(`${hit.source}:${hit.sessionId}`);
    if (hits.length === 1) {
      break;
    }
  }

  assert.equal(hits.length, 1);
  assert.match(hits[0] ?? "", /^(active|archived):thread-/);
});

test("streamSearchHits reports per-thread message counts after file scans complete", async () => {
  const summaries = new Map<string, number>();

  for await (const _hit of streamSearchHits({
    query: "quota",
    codexHomeDir: fixturesDir,
    now: fixedNow,
    onSessionSummary: (summary) => {
      summaries.set(summary.sessionId, summary.messageCount);
    },
  })) {
    // Exhaust the stream.
  }

  assert.equal(summaries.get("thread-active-aaa"), 2);
});

test("streamSearchHits treats missing source directories as empty", async () => {
  const hits = [];

  for await (const hit of streamSearchHits({
    query: "quota",
    codexHomeDir: join(fixturesDir, "missing-home"),
    sources: ["active", "archived"],
    now: fixedNow,
  })) {
    hits.push(hit);
  }

  assert.equal(hits.length, 0);
});

test("searchArchivedSessions applies the default recent window", async () => {
  const defaultResults = await searchArchivedSessions({
    query: "old quota",
    codexHomeDir: fixturesDir,
    now: fixedNow,
  });
  const allTimeResults = await searchArchivedSessions({
    query: "old quota",
    codexHomeDir: fixturesDir,
    allTime: true,
    now: fixedNow,
  });

  assert.equal(defaultResults.hits.length, 0);
  assert.equal(allTimeResults.hits.length, 1);
  assert.equal(allTimeResults.hits[0]?.sessionId, "thread-old-ddd");
});

test("searchArchivedSessions attaches thread titles when available", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    now: fixedNow,
    threadTitles: new Map([
      ["thread-active-aaa", "Investigate quota drift"],
    ]),
  });
  const sessions = aggregateSearchHitsBySession(results.hits);

  assert.equal(results.hits[0]?.title, "Investigate quota drift");
  assert.equal(sessions[0]?.title, "Investigate quota drift");
});

test("streamSearchHits can emit multiple hits from the same thread in a single streamed scan", async () => {
  const sessionIds: string[] = [];

  for await (const hit of streamSearchHits({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
    threadTitles: new Map(),
  })) {
    sessionIds.push(hit.sessionId);
    if (sessionIds.length === 2) {
      break;
    }
  }

  assert.deepEqual(sessionIds.slice(0, 2), ["thread-active-aaa", "thread-active-aaa"]);
});

test("streamSearchHits lets faster files report matches before slower earlier files finish", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "codexs-interleave-"));
  const slowPath = join(
    tempHome,
    "sessions",
    "2026",
    "04",
    "16",
    "rollout-2026-04-16T10-00-00-thread-z-slow.jsonl",
  );
  const fastPath = join(
    tempHome,
    "sessions",
    "2026",
    "04",
    "16",
    "rollout-2026-04-16T09-00-00-thread-a-fast.jsonl",
  );

  await writeSessionFixture({
    filePath: slowPath,
    sessionId: "thread-z-slow",
    timestamp: "2026-04-16T10:00:00.000Z",
    cwd: "/tmp/slow",
    messages: [
      "quota slow first match",
      "quota slow second match",
      "quota slow third match",
    ],
    leadingFillerLines: 50_000,
  });
  await writeSessionFixture({
    filePath: fastPath,
    sessionId: "thread-a-fast",
    timestamp: "2026-04-16T09:00:00.000Z",
    cwd: "/tmp/fast",
    messages: [
      "quota fast first match",
      "quota fast second match",
      "quota fast third match",
    ],
  });

  const sessionIds: string[] = [];
  for await (const hit of streamSearchHits({
    query: "quota",
    codexHomeDir: tempHome,
    allTime: true,
    concurrency: 2,
    threadTitles: new Map(),
  })) {
    sessionIds.push(hit.sessionId);
    if (sessionIds.length === 4) {
      break;
    }
  }

  assert.equal(sessionIds[0], "thread-a-fast");
  assert(sessionIds.includes("thread-z-slow"));
});

test("streamSearchHits uses worker-backed file search when concurrency is greater than one", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "codexs-worker-engine-"));
  await cp(fixturesDir, tempHome, { recursive: true });
  const engines = new Set<string>();

  for await (const _hit of streamSearchHits({
    query: "quota",
    codexHomeDir: tempHome,
    sources: ["active", "archived"],
    now: fixedNow,
    concurrency: 2,
    threadTitles: new Map(),
    onFileSearch: ({ engine }) => {
      if (engine) {
        engines.add(engine);
      }
    },
  })) {
    if (engines.size > 0) {
      break;
    }
  }

  assert(engines.has("worker"));
});

test("streamSearchHits tears down worker searches cleanly when the consumer stops early", async () => {
  const tempHome = await mkdtemp(join(tmpdir(), "codexs-worker-cancel-"));
  const slowPath = join(
    tempHome,
    "sessions",
    "2026",
    "04",
    "16",
    "rollout-2026-04-16T10-00-00-thread-cancel-slow.jsonl",
  );
  const fastPath = join(
    tempHome,
    "sessions",
    "2026",
    "04",
    "16",
    "rollout-2026-04-16T09-00-00-thread-cancel-fast.jsonl",
  );

  await writeSessionFixture({
    filePath: slowPath,
    sessionId: "thread-cancel-slow",
    timestamp: "2026-04-16T10:00:00.000Z",
    cwd: "/tmp/cancel-slow",
    messages: [
      "quota slow cancellation match",
      "quota slow cancellation follow-up",
    ],
    fillerLines: 25_000,
  });
  await writeSessionFixture({
    filePath: fastPath,
    sessionId: "thread-cancel-fast",
    timestamp: "2026-04-16T09:00:00.000Z",
    cwd: "/tmp/cancel-fast",
    messages: [
      "quota fast cancellation match",
    ],
  });

  const engines = new Set<string>();
  const iterator = streamSearchHits({
    query: "quota",
    codexHomeDir: tempHome,
    allTime: true,
    concurrency: 2,
    threadTitles: new Map(),
    onFileSearch: ({ engine }) => {
      engines.add(engine);
    },
  })[Symbol.asyncIterator]();

  const first = await withTimeout(iterator.next(), 2_000, "first worker hit");
  assert.equal(first.done, false);
  assert(engines.has("worker"));

  const completion = iterator.return?.();
  if (completion) {
    await withTimeout(completion, 2_000, "worker iterator cleanup");
  }
});
