import { MessageChannel } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

import Tinypool from "tinypool";

import {
  searchSessionFileHitsWithReporter,
  type SearchFileEntry,
  type SearchFileTaskOptions,
  type SearchFileTaskResult,
  type SearchWorkerChunkMessage,
  type TimeRange,
} from "./session-file-search.js";
import type { SearchHit, SearchSessionSummary, SearchSource } from "./session-reader.js";

const SEARCH_WORKER_EXEC_ARGV = import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : undefined;
const SEARCH_WORKER_FILENAME = fileURLToPath(new URL(
  import.meta.url.endsWith(".ts")
    ? "./session-file-search-worker.ts"
    : "./session-file-search-worker.js",
  import.meta.url,
));

export interface SearchFileBatchOptions {
  query: string;
  cwd: string | null;
  caseSensitive: boolean;
  source: SearchSource;
  timeRange: TimeRange | null;
  signal?: AbortSignal;
  concurrency: number;
  onFileSearch?: (event: { filePath: string; mode: "stream"; engine: "worker" | "local" }) => void;
  onResult?: (result: SearchFileHitResult) => void;
  onWarning?: (warning: { type: "file_read_failed"; filePath: string; code: string | null; message: string }) => void;
  executor: SearchExecutor;
}

export interface SearchFileHitResult {
  file: SearchFileEntry;
  hits: SearchHit[];
  completed: boolean;
  sessionSummary: SearchSessionSummary | null;
}

export interface SearchExecutor {
  engine: "worker" | "local";
  run(
    file: SearchFileEntry,
    options: SearchFileTaskOptions,
    signal?: AbortSignal,
    onChunk?: (hits: SearchHit[]) => void,
  ): Promise<SearchFileTaskResult>;
  destroy(): Promise<void>;
}

export function resolveConcurrency(value: number | undefined): number {
  if (value !== undefined) {
    return Math.max(1, Math.floor(value));
  }

  return Math.max(2, Math.min(8, availableParallelism()));
}

export function createSearchExecutor(concurrency: number, fileCount: number): SearchExecutor {
  if (concurrency <= 1 || fileCount <= 1) {
    return {
      engine: "local",
      run(file, options, signal, onChunk) {
        return searchSessionFileHitsWithReporter(file, {
          ...options,
          signal,
        }, onChunk);
      },
      async destroy() {
        // No-op for local execution.
      },
    };
  }

  const pool = new Tinypool({
    filename: SEARCH_WORKER_FILENAME,
    execArgv: SEARCH_WORKER_EXEC_ARGV,
    minThreads: Math.min(2, concurrency),
    maxThreads: concurrency,
    concurrentTasksPerWorker: 1,
  });

  return {
    engine: "worker",
    run(file, taskOptions, signal, onChunk) {
      if (onChunk) {
        return runWorkerTask(pool, file, taskOptions, signal, onChunk);
      }

      if (!signal) {
        return pool.run({
          file,
          options: taskOptions,
        }) as Promise<SearchFileTaskResult>;
      }

      return pool.run({
        file,
        options: taskOptions,
      }, { signal }) as Promise<SearchFileTaskResult>;
    },
    async destroy() {
      await pool.destroy();
    },
  };
}

export async function* searchStreamedHits(
  files: SearchFileEntry[],
  options: SearchFileBatchOptions,
): AsyncGenerator<SearchFileHitResult> {
  yield* searchFilesInterleaved(files, {
    ...options,
    mode: "stream",
  });
}

async function* searchFilesInterleaved(
  files: SearchFileEntry[],
  options: SearchFileBatchOptions & { mode: "stream" },
): AsyncGenerator<SearchFileHitResult> {
  if (files.length === 0) {
    return;
  }

  const queue: SearchFileHitResult[] = [];
  let nextIndex = 0;
  let activeWorkers = 0;
  let waitForWork: (() => void) | null = null;
  let workerError: unknown = null;

  const notify = () => {
    waitForWork?.();
    waitForWork = null;
  };

  const startWorkers = () => {
    while (!options.signal?.aborted && activeWorkers < options.concurrency && nextIndex < files.length) {
      const file = files[nextIndex];
      if (!file) {
        break;
      }

      nextIndex += 1;
      activeWorkers += 1;
      options.onFileSearch?.({
        filePath: file.filePath,
        mode: options.mode,
        engine: options.executor.engine,
      });

      const onChunk = (hits: SearchHit[]) => {
        if (hits.length === 0) {
          return;
        }

        const result = {
          file,
          hits,
          completed: false,
          sessionSummary: null,
        } satisfies SearchFileHitResult;
        options.onResult?.(result);
        queue.push(result);
        notify();
      };

      options.executor.run(file, {
        query: options.query,
        cwd: options.cwd,
        caseSensitive: options.caseSensitive,
        source: options.source,
        timeRange: options.timeRange,
        mode: options.mode,
      }, options.signal, onChunk)
        .then((taskResult) => {
          const result = {
            file,
            hits: taskResult.hits,
            completed: true,
            sessionSummary: taskResult.sessionSummary,
          } satisfies SearchFileHitResult;
          options.onResult?.(result);
          queue.push(result);
        })
        .catch((error) => {
          if (isRecoverableFileError(error)) {
            options.onWarning?.({
              type: "file_read_failed",
              filePath: file.filePath,
              code: getErrorCode(error),
              message: formatSearchErrorMessage(error),
            });
            return;
          }

          workerError = error;
        })
        .finally(() => {
          activeWorkers -= 1;
          startWorkers();
          notify();
        });
    }
  };

  startWorkers();

  while (queue.length > 0 || activeWorkers > 0) {
    if (workerError) {
      throw workerError;
    }

    const next = queue.shift();
    if (next) {
      yield next;
      continue;
    }

    await new Promise<void>((resolve) => {
      waitForWork = resolve;
    });
  }

  if (workerError) {
    throw workerError;
  }
}

function isRecoverableFileError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "EACCES" || code === "EPERM" || code === "ENOENT";
}

function getErrorCode(error: unknown): string | null {
  return typeof (error as NodeJS.ErrnoException | null)?.code === "string"
    ? (error as NodeJS.ErrnoException).code ?? null
    : null;
}

function formatSearchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runWorkerTask(
  pool: Tinypool,
  file: SearchFileEntry,
  taskOptions: SearchFileTaskOptions,
  signal: AbortSignal | undefined,
  onChunk: (hits: SearchHit[]) => void,
): Promise<SearchFileTaskResult> {
  const { port1, port2 } = new MessageChannel();

  return new Promise<SearchFileTaskResult>((resolve, reject) => {
    let result: SearchFileTaskResult | null = null;
    let doneReceived = false;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      port2.removeListener("message", onMessage);
      port2.close();
      signal?.removeEventListener("abort", onAbort);
    };

    const maybeResolve = () => {
      if (result === null || !doneReceived) {
        return;
      }

      cleanup();
      resolve(result);
    };

    const onMessage = (message: SearchWorkerChunkMessage) => {
      if (message.type === "chunk" && message.hits) {
        onChunk(message.hits);
        return;
      }

      if (message.type === "done") {
        doneReceived = true;
        maybeResolve();
      }
    };

    const onAbort = () => {
      cleanup();
    };

    port2.on("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });

    const runPromise = pool.run({
      file,
      options: taskOptions,
      port: port1,
    }, signal ? { signal, transferList: [port1] } : { transferList: [port1] }) as Promise<SearchFileTaskResult>;

    // The worker can resolve before the final MessagePort chunk is drained on the main thread,
    // so completion waits for both the task result and the explicit done signal.
    runPromise
      .then((taskResult) => {
        result = taskResult;
        maybeResolve();
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}
