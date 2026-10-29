import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { UnaError } from "../errors.ts";
import { profileDir, routeByName } from "../identity.ts";

const PORT_RE = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\//;

export type BrowserKind = "chrome" | "chromium";

export function findChrome(kind: BrowserKind = "chrome"): string | null {
  const env = process.env.UNA_CHROME;
  if (env && fs.existsSync(env)) return env;
  const candidates =
    kind === "chromium"
      ? ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export interface LaunchOpts {
  chrome?: string;
  userDataDir?: string;
  id?: string;
  mode?: "headless" | "headed" | `attach:${number}`;
  route?: string;
  browser?: BrowserKind;
}

export interface LaunchedChrome {
  proc?: ChildProcess;
  port: number;
  userDataDir?: string;
  temp: boolean;
  proxyArgs: string[];
}

function killQuietly(proc: ChildProcess | undefined): void {
  if (proc && !proc.killed) {
    try { proc.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

export async function launchChrome(opts: LaunchOpts = {}): Promise<LaunchedChrome> {
  // attach mode: no spawn at all — we are a client of the user's Chrome
  if (opts.mode?.startsWith("attach")) {
    const port = Number(opts.mode.slice("attach:".length)) || 9222;
    return { port, temp: false, proxyArgs: [] };
  }

  const chrome = opts.chrome ?? findChrome(opts.browser);
  if (!chrome) throw new UnaError("cdp", "no Chrome found", "set UNA_CHROME=/path/to/chrome or install Google Chrome");

  let userDataDir: string;
  let temp: boolean;
  if (opts.userDataDir) {
    userDataDir = opts.userDataDir;
    temp = false;
  } else if (opts.id) {
    userDataDir = profileDir(opts.id);
    fs.mkdirSync(userDataDir, { recursive: true });
    temp = false;
  } else {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "una-"));
    temp = true;
  }

  const proxyArgs = opts.route ? (() => {
    const r = routeByName(opts.route);
    if (r?.proxy) return [`--proxy-server=${r.proxy}`];
    throw new UnaError("grammar", `unknown route '${opts.route}'`, "add it to ~/.una/routes.json");
  })() : [];

  const headed = opts.mode === "headed";
  const args = [
    ...(headed ? [] : ["--headless=new", "--disable-blink-features=AutomationControlled"]),
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...proxyArgs,
    "about:blank",
  ];

  const proc = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });

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

  return { proc, port, userDataDir, temp, proxyArgs };
}

function waitExit(proc: ChildProcess | undefined, ms: number): Promise<void> {
  if (!proc) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), ms);
    proc.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

export async function closeChrome(launched: LaunchedChrome): Promise<void> {
  killQuietly(launched.proc);
  await waitExit(launched.proc, 3000);
  if (launched.temp && launched.userDataDir) {
    try { fs.rmSync(launched.userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}