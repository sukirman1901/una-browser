import { UnaError } from "../errors";

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