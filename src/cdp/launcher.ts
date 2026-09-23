import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { UnaError } from "../errors.ts";

const PORT_RE = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\//;

export function findChrome(): string | null {
  const env = process.env.UNA_CHROME;
  if (env && fs.existsSync(env)) return env;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export interface LaunchedChrome {
  proc: ChildProcess;
  port: number;
  userDataDir: string;
}

function killQuietly(proc: ChildProcess): void {
  if (!proc.killed) {
    try { proc.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

export async function launchChrome(opts: { chrome?: string; userDataDir?: string } = {}): Promise<LaunchedChrome> {
  const chrome = opts.chrome ?? findChrome();
  if (!chrome) throw new UnaError("cdp", "no Chrome found", "set UNA_CHROME=/path/to/chrome or install Google Chrome");
  const userDataDir = opts.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "una-"));
  const proc = spawn(chrome, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const port = await new Promise<number>((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      killQuietly(proc);
      reject(new UnaError("cdp", "Chrome did not report DevTools port in 15s", "check UNA_CHROME path"));
    }, 15_000);
    proc.stderr!.on("data", (d: Buffer) => {
      buffer += d.toString();
      const m = buffer.match(PORT_RE);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new UnaError("cdp", `Chrome exited early (code ${code})`, "check UNA_CHROME path"));
    });
    proc.once("error", (err) => {
      clearTimeout(timer);
      reject(new UnaError("cdp", `Chrome spawn error: ${err.message}`));
    });
  });

  return { proc, port, userDataDir };
}

function waitExit(proc: ChildProcess, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), ms);
    proc.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

export async function closeChrome(launched: LaunchedChrome): Promise<void> {
  killQuietly(launched.proc);
  await waitExit(launched.proc, 3000);
  try { fs.rmSync(launched.userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}