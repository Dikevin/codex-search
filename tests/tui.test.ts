import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { join } from "node:path";

import { searchArchivedSessions, type SearchResultsPage } from "../src/search/session-reader.js";
import {
  createInitialTuiState,
  renderSearchTuiScreen,
  runSearchTui,
  toggleExpandedSelection,
} from "../src/tui/index.js";

const fixturesDir = join(import.meta.dirname, "fixtures", "codex-home");
const fixedNow = new Date("2026-04-16T12:00:00.000Z");

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");
}

function measureDisplayWidth(value: string): number {
  let width = 0;

  for (const char of stripAnsi(value)) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (
      codePoint === 0 ||
      (codePoint >= 0x0300 && codePoint <= 0x036f) ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    ) {
      continue;
    }

    width += isFullWidthCodePoint(codePoint) ? 2 : 1;
  }

  return width;
}

function isFullWidthCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function createTuiStdout(columns: number, rows: number) {
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  }) as NodeJS.WriteStream;

  stream.columns = columns;
  stream.rows = rows;

  return {
    stream,
    read() {
      return text;
    },
  };
}

function createTuiStdin() {
  const stream = new PassThrough() as NodeJS.ReadStream;
  stream.isTTY = true;
  stream.isRaw = false;
  stream.setRawMode = (raw: boolean) => {
    stream.isRaw = raw;
    return stream;
  };

  return stream;
}

function createResults(count: number, overrides?: {
  title?: (index: number) => string | null;
  cwd?: (index: number) => string | null;
  snippet?: (index: number) => string;
}): SearchResultsPage {
  return {
    hits: Array.from({ length: count }, (_, index) => ({
      sessionId: `thread-${index + 1}`,
      timestamp: `2026-04-${String(20 - index).padStart(2, "0")}T10:00:00.000Z`,
      cwd: overrides?.cwd?.(index) ?? `/tmp/project-${index + 1}`,
      title: overrides?.title?.(index) ?? `Thread ${index + 1}`,
      snippet: overrides?.snippet?.(index) ?? `quota result ${index + 1}`,
      preview: {
        kind: index % 2 === 0 ? "user" : "assistant",
        label: index % 2 === 0 ? "User" : "Assistant",
        text: overrides?.snippet?.(index) ?? `quota result ${index + 1}`,
        timestamp: `2026-04-${String(20 - index).padStart(2, "0")}T10:0${index}:00.000Z`,
        secondaryText: null,
      },
      source: "active" as const,
      filePath: `/tmp/thread-${index + 1}.jsonl`,
      resumeCommand: `codex resume thread-${index + 1}`,
      deepLink: `codex://threads/thread-${index + 1}`,
    })),
    page: 1,
    pageSize: Math.max(5, count),
    offset: 0,
    hasMore: false,
  };
}

function createThreadResults(matchCount: number, overrides?: {
  text?: (index: number) => string;
  title?: string;
  sessionId?: string;
}): SearchResultsPage {
  const sessionId = overrides?.sessionId ?? "thread-detail";
  return {
    hits: Array.from({ length: matchCount }, (_, index) => ({
      sessionId,
      timestamp: `2026-04-15T10:${String(index).padStart(2, "0")}:00.000Z`,
      cwd: "/tmp/detail-thread",
      title: overrides?.title ?? "Detail thread",
      snippet: overrides?.text?.(index) ?? `detail match ${index + 1}`,
      preview: {
        kind: index % 2 === 0 ? "user" : "assistant",
        label: index % 2 === 0 ? "User" : "Assistant",
        text: overrides?.text?.(index) ?? `detail match ${index + 1}`,
        timestamp: `2026-04-15T10:${String(index).padStart(2, "0")}:30.000Z`,
        secondaryText: null,
      },
      source: "active" as const,
      filePath: `/tmp/${sessionId}.jsonl`,
      resumeCommand: `codex resume ${sessionId}`,
      deepLink: `codex://threads/${sessionId}`,
    })),
    page: 1,
    pageSize: Math.max(5, matchCount),
    offset: 0,
    hasMore: false,
  };
}

test("renderSearchTuiScreen shows thread-level rows by default", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
    threadTitles: new Map([["thread-active-aaa", "Investigate quota drift"]]),
  });

  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: createInitialTuiState(),
    width: 120,
    height: 24,
    sourceLabel: "all",
    rangeLabel: "recent 30d",
  }));

  assert.match(screen, /Investigate quota drift/);
  assert.match(screen, /source: all/);
  assert.match(screen, /range: recent 30d/);
  assert.match(screen, /2 threads/);
  assert.match(screen, /4 matches/);
  assert.doesNotMatch(screen, /resume:/);
  assert.doesNotMatch(screen, /open:/);
});

test("renderSearchTuiScreen expands the selected thread details in a responsive panel", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
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
  assert.match(screen, /1\. Assistant/);
  assert.match(screen, /I found quota drift in the billing summary\./i);
  assert.match(screen, /2\. User/);
  assert.match(screen, /Please investigate quota drift in production\./i);
  assert.match(screen, /Space/);
});

test("renderSearchTuiScreen keeps narrow expanded details separate from the list", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
  });

  const state = toggleExpandedSelection(createInitialTuiState(), results.hits);
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state,
    width: 60,
    height: 12,
  }));
  const lines = screen.split("\n");
  const detailsIndex = lines.findIndex((line) => line.includes("Details"));
  const archivedIndex = lines.findIndex((line) => line.includes("thread-archived-bbb"));

  assert.equal(lines.length, 12);
  assert(detailsIndex > archivedIndex);
  assert.match(lines.at(-2) ?? "", /q quit/);
  assert.match(screen, /Details/);
});

test("renderSearchTuiScreen uses side-by-side details on wide terminals", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
  });

  const state = toggleExpandedSelection(createInitialTuiState(), results.hits);
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state,
    width: 120,
    height: 18,
  }));

  assert.match(screen, /│ Details/);
  assert.match(screen, /thread-active-aaa/);
  assert.match(screen, /│ cwd:/);
});

test("renderSearchTuiScreen shows an english header row for the result columns", () => {
  const results = createResults(3);
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: createInitialTuiState(),
    width: 120,
    height: 16,
  }));

  assert.match(screen, /Time/);
  assert.match(screen, /Title/);
  assert.match(screen, /Cwd/);
  assert.match(screen, /Matches/);
});

test("renderSearchTuiScreen reports selected and visible thread ranges", () => {
  const results = createResults(5);
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: {
      selected: 2,
      scrollTop: 1,
      expandedSessionId: "thread-3",
      focus: "list",
      detailSelected: 0,
      statusMessage: null,
    },
    width: 60,
    height: 12,
    sourceLabel: "active",
    rangeLabel: "recent 30d",
  }));

  assert.match(screen, /5 threads/);
  assert.match(screen, /selected 3\/5/);
  assert.match(screen, /visible 2-2/);
});

test("renderSearchTuiScreen shows global scan progress with a status spinner", () => {
  const results = createResults(2);
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: {
      ...createInitialTuiState(),
      expandedSessionId: "thread-1",
      focus: "list",
    },
    width: 100,
    height: 18,
    nowMs: 0,
    searching: true,
    progress: {
      totalFiles: 5,
      readyFiles: 2,
      scannedFiles: 2,
      activeFiles: 1,
      fileStates: {
        "/tmp/thread-1.jsonl": "scanning",
        "/tmp/thread-2.jsonl": "done",
      },
    },
  }));

  assert.match(screen, /scan 2\/5/);
  assert.match(screen, /⠋ Searching/);
  assert.doesNotMatch(screen, /St\s+Time/);
  assert.doesNotMatch(screen, /thread scanning/);

  const completedScreen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: createInitialTuiState(),
    width: 100,
    height: 18,
    searching: false,
    progress: {
      totalFiles: 5,
      readyFiles: 5,
      scannedFiles: 5,
      activeFiles: 0,
      fileStates: {
        "/tmp/thread-1.jsonl": "done",
        "/tmp/thread-2.jsonl": "done",
      },
    },
  }));

  assert.doesNotMatch(completedScreen, /St\s+Time/);
  assert.match(completedScreen, /Search complete/);
});

test("renderSearchTuiScreen inserts time bucket separators between age groups", () => {
  const nowMs = Date.parse("2026-04-15T12:00:00.000Z");
  const results: SearchResultsPage = {
    hits: [
      {
        sessionId: "thread-recent",
        timestamp: "2026-04-15T10:00:00.000Z",
        cwd: "/tmp/recent",
        title: "Recent",
        snippet: "recent quota",
        preview: { kind: "user", label: "User", text: "recent quota", timestamp: "2026-04-15T10:00:00.000Z", secondaryText: null },
        source: "active",
        filePath: "/tmp/recent.jsonl",
        resumeCommand: "codex resume thread-recent",
        deepLink: "codex://threads/thread-recent",
      },
      {
        sessionId: "thread-3d",
        timestamp: "2026-04-13T10:00:00.000Z",
        cwd: "/tmp/three-day",
        title: "Three day",
        snippet: "three day quota",
        preview: { kind: "user", label: "User", text: "three day quota", timestamp: "2026-04-13T10:00:00.000Z", secondaryText: null },
        source: "active",
        filePath: "/tmp/three-day.jsonl",
        resumeCommand: "codex resume thread-3d",
        deepLink: "codex://threads/thread-3d",
      },
      {
        sessionId: "thread-week",
        timestamp: "2026-04-08T10:00:00.000Z",
        cwd: "/tmp/week",
        title: "Week",
        snippet: "week quota",
        preview: { kind: "user", label: "User", text: "week quota", timestamp: "2026-04-08T10:00:00.000Z", secondaryText: null },
        source: "active",
        filePath: "/tmp/week.jsonl",
        resumeCommand: "codex resume thread-week",
        deepLink: "codex://threads/thread-week",
      },
    ],
    page: 1,
    pageSize: 5,
    offset: 0,
    hasMore: false,
  };

  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: createInitialTuiState(),
    width: 100,
    height: 16,
    nowMs,
  }));

  assert.match(screen, /\[<1d\]/);
  assert.match(screen, /\[<3d\]/);
  assert.match(screen, /\[<2w\]/);
});

test("renderSearchTuiScreen truncates long thread titles before dropping cwd context", () => {
  const results = createResults(1, {
    title: () => "This thread title is intentionally extremely long so it should truncate before cwd disappears",
    cwd: () => "/Users/bytedance/Documents/projects/chat",
  });
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: createInitialTuiState(),
    width: 72,
    height: 12,
  }));
  const row = screen.split("\n").find((line) => line.includes("chat"));

  assert(row);
  assert.match(row, /chat/);
  assert.match(row, /…/);
  assert.doesNotMatch(row, /This thread title is intentionally extremely long so it should truncate before cwd disappears/);
});

test("renderSearchTuiScreen truncates long CJK titles to terminal display width", () => {
  const results = createResults(2, {
    title: (index) => index === 0
      ? "全局git配置修改下 code.byted.org用bytedance.com 其他都用gmail.com 这行需要在终端里按显示宽度截断"
      : `Thread ${index + 1}`,
    cwd: () => "/Users/bytedance/Documents/projects/chat",
  });
  const screen = renderSearchTuiScreen({
    query: "quota",
    results,
    state: createInitialTuiState(),
    width: 80,
    height: 12,
  });
  const row = screen.split("\n").find((line) => line.includes("chat"));

  assert(row);
  assert(measureDisplayWidth(row) <= 80);
  assert.match(stripAnsi(row), /chat/);
  assert.match(stripAnsi(row), /…/);
});

test("renderSearchTuiScreen wraps detail snippets across multiple lines", () => {
  const results = createResults(1, {
    snippet: () => "quota drift investigation needs a much longer snippet so the detail pane should wrap it across multiple lines instead of squeezing everything into one row",
  });
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: {
      ...createInitialTuiState(),
      expandedSessionId: "thread-1",
    },
    width: 80,
    height: 18,
  }));

  assert.match(screen, /1\. User/);
  assert.match(screen, /quota drift investigation needs a much longer snippet/);
  assert.match(screen, /wrap it across multiple lines instead/);
});

test("renderSearchTuiScreen condenses detail metadata and preserves body room", () => {
  const results = createThreadResults(1, {
    title: "Detail thread with an intentionally verbose title to force truncation",
    text: () => "quota detail body should keep enough room to show at least three wrapped lines in the transcript area for the selected item",
  });
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: {
      ...createInitialTuiState(),
      expandedSessionId: "thread-detail",
      focus: "detail",
    },
    width: 82,
    height: 16,
  }));

  assert.doesNotMatch(screen, /open:/);
  assert.doesNotMatch(screen, /resume:/);
  assert.match(screen, /cwd:/);
  assert.match(screen, /quota detail body should keep enough room/);
  assert.match(screen, /show at least three wrapped lines/);
  assert.match(screen, /transcript area for the selected item/);
});

test("renderSearchTuiScreen shows the selected thread in details while list focus is active", () => {
  const results = createResults(2, {
    title: (index) => index === 0 ? "Alpha detail thread" : "Beta detail thread",
    snippet: (index) => index === 0 ? "alpha detail body" : "beta detail body",
  });
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "detail",
    results,
    state: {
      ...createInitialTuiState(),
      selected: 1,
      expandedSessionId: "thread-1",
      focus: "list",
    },
    width: 100,
    height: 18,
  }));

  assert.match(screen, /title: Beta detail thread/);
  assert.match(screen, /beta detail body/);
});

test("renderSearchTuiScreen sanitizes control characters in title and preserves detail line breaks", () => {
  const results = createResults(1, {
    title: () => "Thread\u001B[31m\nquota\tname",
    snippet: () => "first line\nsecond quota line\n\nthird line",
  });
  const raw = renderSearchTuiScreen({
    query: "quota",
    results,
    state: {
      ...createInitialTuiState(),
      expandedSessionId: "thread-1",
      focus: "detail",
    },
    width: 90,
    height: 20,
  });
  const screen = stripAnsi(raw);

  assert.doesNotMatch(screen, /\u001B\[31m/);
  assert.match(screen, /Thread quota name/);
  assert.match(screen, /first line/);
  assert.match(screen, /second quota line/);
  assert.match(screen, /third line/);
});

test("renderSearchTuiScreen highlights keyword in list and detail without breaking layout", () => {
  const results = createResults(1, {
    title: () => "quota investigation",
    snippet: () => "this detail mentions quota twice: quota",
  });
  const raw = renderSearchTuiScreen({
    query: "quota",
    results,
    state: {
      ...createInitialTuiState(),
      expandedSessionId: "thread-1",
      focus: "detail",
    },
    width: 96,
    height: 18,
  });

  assert.match(raw, /\u001B\[4mquota/);
  assert(measureDisplayWidth(raw.split("\n")[5] ?? "") <= 96);
});

test("renderSearchTuiScreen shows detail focus status and starts detail view from the selected match", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
  });
  const screen = stripAnsi(renderSearchTuiScreen({
    query: "quota",
    results,
    state: {
      ...createInitialTuiState(),
      expandedSessionId: "thread-active-aaa",
      focus: "detail",
      detailSelected: 1,
    },
    width: 140,
    height: 24,
    cwdLabel: "chat",
  }));

  assert.match(screen, /cwd: chat/);
  assert.match(screen, /detail 2\/2/);
  assert.match(screen, /1\. Assistant/);
  assert.match(screen, /› 2\. User/);
});

test("renderSearchTuiScreen includes dates for cross-day detail timestamps", () => {
  const results = createThreadResults(2, {
    text: (index) => `detail match ${index + 1}`,
  });
  results.hits[0] = {
    ...results.hits[0]!,
    timestamp: "2026-04-15T23:59:00.000Z",
    preview: {
      ...results.hits[0]!.preview,
      timestamp: "2026-04-15T23:59:30.000Z",
    },
  };
  results.hits[1] = {
    ...results.hits[1]!,
    timestamp: "2026-04-16T00:01:00.000Z",
    preview: {
      ...results.hits[1]!.preview,
      timestamp: "2026-04-16T00:01:30.000Z",
    },
  };

  const screen = stripAnsi(renderSearchTuiScreen({
    query: "detail",
    results,
    state: {
      ...createInitialTuiState(),
      expandedSessionId: "thread-detail",
      focus: "detail",
    },
    width: 100,
    height: 20,
  }));

  assert.match(screen, /04-16 00:01/);
});

test("runSearchTui redraws when the terminal is resized", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
  });
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(40, 12);

  const run = runSearchTui({
    query: "quota",
    results,
    stdin,
    stdout: stdout.stream,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stdout.stream.columns = 100;
  stdout.stream.rows = 24;
  stdout.stream.emit("resize");
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  assert.match(stripAnsi(stdout.read()), /q quit/);
  assert.match(stripAnsi(stdout.read()), /Space detail/);
});

test("runSearchTui enters and exits the alternate screen only once", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    now: fixedNow,
  });
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(80, 18);

  const run = runSearchTui({
    query: "quota",
    results,
    stdin,
    stdout: stdout.stream,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stdout.stream.columns = 100;
  stdout.stream.rows = 24;
  stdout.stream.emit("resize");
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);

  const output = stdout.read();
  assert.equal((output.match(/\u001B\[\?1049h/g) ?? []).length, 1);
  assert.equal((output.match(/\u001B\[\?1049l/g) ?? []).length, 1);
});

test("runSearchTui pauses stdin when quitting", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    now: fixedNow,
  });
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(80, 18);
  let paused = false;
  const originalPause = stdin.pause.bind(stdin);
  stdin.pause = () => {
    paused = true;
    return originalPause();
  };

  const run = runSearchTui({
    query: "quota",
    results,
    stdin,
    stdout: stdout.stream,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  assert.equal(paused, true);
});

test("runSearchTui does not open archived threads", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
  });
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(100, 20);
  const opened: string[] = [];

  const run = runSearchTui({
    query: "quota",
    results,
    stdin,
    stdout: stdout.stream,
    openHit: async (hit) => {
      opened.push(hit.deepLink);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "j", { name: "j" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "\r", { name: "return" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  assert.deepEqual(opened, []);
  assert.match(stripAnsi(stdout.read()), /Archived thread cannot be reopened directly/);
});

test("runSearchTui can open a thread without leaving the picker", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    now: fixedNow,
  });
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(100, 20);
  const opened: string[] = [];

  const run = runSearchTui({
    query: "quota",
    results,
    stdin,
    stdout: stdout.stream,
    openHit: async (hit) => {
      opened.push(hit.deepLink);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "o", { name: "o" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  assert.deepEqual(opened, ["codex://threads/thread-active-aaa"]);
  assert.match(stripAnsi(stdout.read()), /o stay/);
});

test("runSearchTui does not resume archived threads", async () => {
  const results = await searchArchivedSessions({
    query: "quota",
    codexHomeDir: fixturesDir,
    sources: ["active", "archived"],
    now: fixedNow,
  });
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(100, 20);
  const resumed: string[] = [];

  const run = runSearchTui({
    query: "quota",
    results,
    stdin,
    stdout: stdout.stream,
    resumeHit: async (hit) => {
      resumed.push(hit.sessionId);
      return 0;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "j", { name: "j" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "r", { name: "r" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  assert.deepEqual(resumed, []);
  assert.match(stripAnsi(stdout.read()), /Archived thread cannot be reopened directly/);
});

test("runSearchTui renders while a streamed search is still running", async () => {
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(100, 20);

  async function* delayedHits() {
    await new Promise((resolve) => setTimeout(resolve, 30));
    yield {
      sessionId: "thread-streamed",
      timestamp: "2026-04-16T10:00:00.000Z",
      cwd: "/tmp/streamed",
      snippet: "streamed quota result",
      source: "active" as const,
      filePath: "/tmp/streamed.jsonl",
      resumeCommand: "codex resume thread-streamed",
      deepLink: "codex://threads/thread-streamed",
    };
  }

  const run = runSearchTui({
    query: "quota",
    results: {
      hits: [],
      page: 1,
      pageSize: 5,
      offset: 0,
      hasMore: false,
    },
    hitStream: delayedHits(),
    stdin,
    stdout: stdout.stream,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(stripAnsi(stdout.read()), /Searching/);

  await new Promise((resolve) => setTimeout(resolve, 50));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  assert.match(stripAnsi(stdout.read()), /thread-streamed/);
});

test("runSearchTui keeps animating while search has no new events", async () => {
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(100, 20);
  const pendingStream = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<never>>(() => {}),
        return: async () => ({ done: true, value: undefined }),
      };
    },
  };

  const run = runSearchTui({
    query: "quota",
    hitStream: pendingStream,
    stdin,
    stdout: stdout.stream,
  });

  await new Promise((resolve) => setTimeout(resolve, 260));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  assert((stdout.read().match(/codexs/g) ?? []).length >= 2);
});

test("runSearchTui coalesces rapid search updates", async () => {
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(100, 20);

  async function* manyHits() {
    for (let index = 0; index < 50; index += 1) {
      yield {
        sessionId: `thread-${index}`,
        timestamp: `2026-04-16T10:${String(index).padStart(2, "0")}:00.000Z`,
        cwd: "/tmp/bulk",
        title: `Bulk ${index}`,
        snippet: "bulk quota result",
        source: "active" as const,
        filePath: `/tmp/bulk-${index}.jsonl`,
        resumeCommand: `codex resume thread-${index}`,
        deepLink: `codex://threads/thread-${index}`,
      };
    }
  }

  const run = runSearchTui({
    query: "quota",
    hitStream: manyHits(),
    stdin,
    stdout: stdout.stream,
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  assert(stripAnsi(stdout.read()).split("codexs").length < 15);
});

test("runSearchTui pages through detail previews", async () => {
  const results = createThreadResults(12);
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(100, 20);

  const run = runSearchTui({
    query: "detail",
    results,
    stdin,
    stdout: stdout.stream,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", " ", { name: "space" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "", { name: "pagedown" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  const output = stripAnsi(stdout.read());
  assert.match(output, /detail 3\/12/);
  assert.match(output, /› 3\. Assistant\s+10:09/);
});

test("runSearchTui lets the detail cursor move within the visible preview window", async () => {
  const results = createThreadResults(5);
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(100, 20);

  const run = runSearchTui({
    query: "detail",
    results,
    stdin,
    stdout: stdout.stream,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", " ", { name: "space" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "j", { name: "j" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  const output = stripAnsi(stdout.read());
  assert.match(output, /1\. User\s+10:04/);
  assert.match(output, /› 2\. Assistant\s+10:03/);
});

test("runSearchTui uses tab to switch back to list focus and updates details with selection", async () => {
  const results = createResults(2, {
    title: (index) => index === 0 ? "Alpha detail thread" : "Beta detail thread",
    snippet: (index) => index === 0 ? "alpha detail body" : "beta detail body",
  });
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(110, 22);

  const run = runSearchTui({
    query: "detail",
    results,
    stdin,
    stdout: stdout.stream,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", " ", { name: "space" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "\t", { name: "tab" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "j", { name: "j" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  const output = stripAnsi(stdout.read());
  assert.match(output, /title: Beta detail thread/);
  assert.match(output, /beta detail body/);
  assert.match(output, /Tab/);
});

test("runSearchTui searches within detail previews with slash and n", async () => {
  const results = createThreadResults(5, {
    text: (index) => (
      index === 1 || index === 4
        ? `alpha detail match ${index + 1}`
        : `plain detail match ${index + 1}`
    ),
  });
  const stdin = createTuiStdin();
  const stdout = createTuiStdout(110, 22);

  const run = runSearchTui({
    query: "detail",
    results,
    stdin,
    stdout: stdout.stream,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", " ", { name: "space" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "l", { name: "l" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "/", { name: "/" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  for (const char of ["a", "l", "p", "h", "a"]) {
    stdin.emit("keypress", char, { name: char });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  stdin.emit("keypress", "\r", { name: "return" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "n", { name: "n" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  stdin.emit("keypress", "q", { name: "q" });

  assert.equal(await run, 0);
  const output = stripAnsi(stdout.read());
  assert.match(output, /\/alpha/);
  assert.match(output, /detail 1\/5/);
  assert.match(output, /detail 4\/5/);
});
