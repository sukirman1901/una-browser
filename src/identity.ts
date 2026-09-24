import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function root(): string {
  return process.env.UNA_ROOT ?? path.join(os.homedir(), ".una");
}

function ensureRoot(): string {
  const r = root();
  fs.mkdirSync(r, { recursive: true });
  return r;
}

export function profileDir(id: string): string {
  return path.join(ensureRoot(), "profiles", id);
}

export function profileUaPath(id: string): string {
  return path.join(ensureRoot(), "ua", id);
}

export interface DaemonInfo {
  id: string;
  port: number;
  mode: string;
  route?: string;
  pid: number;
}

export function registerDaemon(info: DaemonInfo): void {
  const p = path.join(ensureRoot(), "daemons", `${info.id}.json`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(info));
}

export function daemonPort(id: string): number | null {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(ensureRoot(), "daemons", `${id}.json`), "utf8")) as { port?: number };
    return typeof info.port === "number" ? info.port : null;
  } catch {
    return null;
  }
}

export interface Route {
  proxy?: string;
  [k: string]: unknown;
}

export function routeByName(name: string): Route | null {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(ensureRoot(), "routes.json"), "utf8")) as Record<string, Route>;
    return all[name] ?? null;
  } catch {
    return null;
  }
}