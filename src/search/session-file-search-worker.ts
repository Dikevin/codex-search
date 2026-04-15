import type { MessagePort } from "node:worker_threads";

import {
  searchSessionFileHitsWithReporter,
  type SearchFileEntry,
  type SearchFileTaskOptions,
  type SearchFileTaskResult,
  type SearchWorkerChunkMessage,
} from "./session-file-search.ts";

export default async function run(task: {
  file: SearchFileEntry;
  options: SearchFileTaskOptions;
  port?: MessagePort;
}): Promise<SearchFileTaskResult> {
  const result = await searchSessionFileHitsWithReporter(
    task.file,
    task.options,
    task.port
      ? (hits) => {
        task.port?.postMessage({ type: "chunk", hits } satisfies SearchWorkerChunkMessage);
      }
      : undefined,
  );

  task.port?.postMessage({ type: "done" } satisfies SearchWorkerChunkMessage);
  return result;
}
