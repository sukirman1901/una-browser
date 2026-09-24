import { UnaError } from "../errors";
import type { TabManager } from "../tabs";

export interface ParallelJob {
  url: string;
  js?: string;
}

export const PARALLEL_MAX_JOBS = 8;

function isJobLike(j: unknown): j is { url: string; js?: string } {
  return !!j && typeof j === "object" && typeof (j as { url?: unknown }).url === "string";
}

export function normalizeJobs(input: unknown, cap = PARALLEL_MAX_JOBS): ParallelJob[] {
  let jobs: ParallelJob[];
  if (Array.isArray(input)) {
    jobs = input.map((j) => {
      if (typeof j === "string") return { url: j };
      if (isJobLike(j)) {
        const js = j.js === undefined ? undefined : String(j.js);
        return { url: j.url, ...(js !== undefined ? { js } : {}) };
      }
      throw new UnaError("grammar", "parallel: jobs must be url strings or {url,js} objects", 'usage: una parallel \'[{"url":"https://a","js":"() => document.title"}]\'');
    });
  } else if (isPlainObject(input)) {
    const obj = input as Record<string, unknown>;
    const urls = obj.urls;
    if (!Array.isArray(urls) || urls.some((u) => typeof u !== "string" || u === "")) {
      throw new UnaError("grammar", "parallel: {urls:[...]} requires non-empty url strings", 'usage: una parallel \'{"urls":["https://a","https://b"],"js":"() => document.title"}\'');
    }
    const js = obj.js === undefined ? undefined : String(obj.js);
    jobs = urls.map((u) => ({ url: u, ...(js !== undefined ? { js } : {}) }));
  } else {
    throw new UnaError("grammar", "parallel requires {urls:[...]} or a job array", 'usage: una parallel \'{"urls":["https://a"]}\'');
  }
  if (jobs.length === 0) throw new UnaError("grammar", "parallel: no jobs", 'usage: una parallel \'{"urls":["https://a"]}\'');
  if (jobs.length > cap) throw new UnaError("invalid", `parallel: max ${cap} jobs (got ${jobs.length})`);
  return jobs;
}

function isPlainObject(x: unknown): boolean {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function asExpression(js: string): string {
  const t = js.trim();
  if (!t) throw new UnaError("grammar", "parallel: js is empty", 'usage: "js":"() => document.title"');
  const looksLikeFunction = /=>/.test(t) || /^(?:async\s+)?function\b/.test(t);
  return looksLikeFunction ? `(${t})()` : t;
}

export interface ParallelResult {
  status: "ok" | "error";
  url: string;
  title?: string;
  result?: unknown;
  message?: string;
}

export interface ParallelSummary {
  ok: boolean;
  parallel: true;
  okCount: number;
  failed: number;
  results: ParallelResult[];
}

export function settleParallel(results: ParallelResult[]): ParallelSummary {
  const okCount = results.filter((r) => r.status === "ok").length;
  return { ok: okCount === results.length, parallel: true, okCount, failed: results.length - okCount, results };
}

export async function runParallel(tabs: TabManager, jobs: ParallelJob[]): Promise<ParallelSummary> {
  const before = tabs.focused().index;
  const results: ParallelResult[] = await Promise.all(
    jobs.map(async (job) => {
      try {
        return await oneJob(tabs, job);
      } catch (e) {
        return { status: "error", url: job.url, message: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  try {
    await tabs.switch(before);
  } catch {
    // parallel closed the only manual tab — nothing to restore focus to
  }
  return settleParallel(results);
}

async function oneJob(tabs: TabManager, job: ParallelJob): Promise<ParallelResult> {
  const slot = await tabs.create(job.url, { ephemeral: true });
  try {
    const current = await slot.session.current().catch(() => ({ url: job.url, title: "" }));
    let result: unknown;
    if (job.js !== undefined) {
      const expr = asExpression(job.js);
      const res = await slot.session.client.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new UnaError("cdp", `eval error: ${JSON.stringify(res.exceptionDetails)}`);
      result = (res.result as { value?: unknown }).value ?? null;
    }
    return { status: "ok", url: current.url, title: current.title, ...(result !== undefined ? { result } : {}) };
  } finally {
    await tabs.closeSlot(slot).catch(() => {});
  }
}