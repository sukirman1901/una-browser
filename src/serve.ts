import type { Server } from "bun";
import { launchChrome, closeChrome, type LaunchedChrome, type BrowserKind } from "./cdp/launcher";
import { PageSession } from "./cdp/session";
import { Controller } from "./actions/exec";
import { TabManager, firstSlot } from "./tabs";
import { parseArgs, type HarnessMode } from "./args";
import { UnaError, type ErrorCode } from "./errors";
import { daemonPort as daemonPortOf, idPort, registerDaemon, profileDir, profileUaPath } from "./identity";
import { homedir } from "node:os";
import { join } from "node:path";
import { VaultManager } from "./vault/manager";
import { startVaultSocket, connectSharedVault, sendVaultRequest } from "./vault/ipc";
import { startVaultUi } from "./vault/ui-server";

const PORT = Number(process.env.UNA_PORT ?? 17911);

export interface Daemon {
  controller: Controller;
  http: Server<undefined>;
  chrome: LaunchedChrome;
  vaultSocket: { close: () => Promise<void> };
  vaultUi: ReturnType<typeof startVaultUi>;
  vault: VaultManager;
  sharedVault?: Awaited<ReturnType<typeof connectSharedVault>>;
}

export interface ServeOpts {
  id?: string;
  mode?: HarnessMode;
  route?: string;
  browser?: BrowserKind;
  userDataDir?: string;
}

export async function startDaemon(port = PORT, opts: ServeOpts = {}): Promise<Daemon> {
  // An unnamed daemon is a normal user session: persist it in the default profile so logins survive restarts.
  const chrome = await launchChrome({ ...opts, userDataDir: opts.id ? opts.userDataDir : profileDir("default") });
  try {
    const session = await PageSession.connect(chrome.port);
    if (opts.id && headlessForUa(opts.mode)) await applyProfileUa(session, opts.id);
    const root = process.env.UNA_ROOT ?? join(homedir(), ".una");
    const vault = new VaultManager(root);
    let sharedUiUrl = "";
    const sharedVault = await connectSharedVault(vault, root, () => sharedUiUrl);
    const controller = new Controller(session, new TabManager(chrome.port, firstSlot(session)), sharedVault.vault);
    let vaultSocket: Awaited<ReturnType<typeof startVaultSocket>>;
    // The CLI socket and the agent must use the same binding: a borrowing profile reflects the owner vault.
    try { vaultSocket = await startVaultSocket(sharedVault.vault, root, port); }
    catch (error) { await sharedVault.close(); throw error; }
    let vaultUi: ReturnType<typeof startVaultUi> | undefined;
    try {
      if (sharedVault.owner) {
        vaultUi = startVaultUi(vault);
        sharedUiUrl = vaultUi.url;
      } else {
        sharedUiUrl = await sendVaultRequest(root, -1, { action: "ui-url" }).then((reply) => reply.result as string);
        if (!sharedUiUrl?.startsWith("http://127.0.0.1:")) throw new Error("shared vault UI unavailable");
        const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
          if (req.method !== "GET") return new Response("Forbidden", { status: 403 });
          return Response.redirect(sharedUiUrl, 303);
        } });
        vaultUi = { http, url: sharedUiUrl, close: async () => { await http.stop(); } };
      }
      return await buildDaemon({ chrome, session, controller, vault, vaultSocket, vaultUi, sharedUiUrl, sharedVault, port, opts });
    } catch (error) {
      await vaultUi?.close().catch(() => {});
      await vaultSocket.close().catch(() => {});
      await sharedVault.close().catch(() => {});
      throw error;
    }
  } catch (error) {
    await closeChrome(chrome);
    throw error;
  }
}

async function buildDaemon(parts: {
  chrome: LaunchedChrome;
  session: PageSession;
  controller: Controller;
  vault: VaultManager;
  vaultSocket: Awaited<ReturnType<typeof startVaultSocket>>;
  vaultUi: ReturnType<typeof startVaultUi>;
  sharedVault: Awaited<ReturnType<typeof connectSharedVault>>;
  sharedUiUrl: string;
  port: number;
  opts: ServeOpts;
}): Promise<Daemon> {
  const { chrome, session, controller, vault, vaultSocket, vaultUi, sharedVault, sharedUiUrl, port, opts } = parts;

  const http = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/healthz") {
        return new Response(JSON.stringify({ ok: true, url: await controller.session.current(), vaultUiUrl: sharedUiUrl }), { headers: { "content-type": "application/json" } });
      }
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body: { commands?: string[]; cmd?: string; parallel?: unknown };
      try {
        body = (await req.json()) as { commands?: string[]; cmd?: string; parallel?: unknown };
      } catch {
        return new Response(JSON.stringify({ ok: false, error: { code: "grammar", message: "expected JSON body" } }), { status: 400, headers: { "content-type": "application/json" } });
      }
      if (typeof body.cmd === "string") {
        try {
          const c = parseArgs(body.cmd.trim().split(/\s+/));
          const result = await controller.exec(c);
          return new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
        } catch (e) {
          const err = e instanceof UnaError ? e : new UnaError("cdp", e instanceof Error ? e.message : String(e));
          return new Response(JSON.stringify({ ok: false, error: { code: err.code, message: err.message, hint: err.hint } }), { status: 400, headers: { "content-type": "application/json" } });
        }
      }
      if (Array.isArray(body.commands)) {
        const { runBatch } = await import("./parallel/batch");
        const results = await runBatch(controller, body.commands);
        return new Response(JSON.stringify({ ok: true, result: results }), { headers: { "content-type": "application/json" } });
      }
      if (body.parallel !== undefined) {
        try {
          const { normalizeJobs } = await import("./parallel/tabs");
          const jobs = normalizeJobs(body.parallel);
          return new Response(JSON.stringify({ ok: true, result: await controller.parallelJobs(jobs) }), { headers: { "content-type": "application/json" } });
        } catch (e) {
          const err = e instanceof UnaError ? e : new UnaError("cdp", e instanceof Error ? e.message : String(e));
          return new Response(JSON.stringify({ ok: false, error: { code: err.code, message: err.message, hint: err.hint } }), { status: 400, headers: { "content-type": "application/json" } });
        }
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "grammar", message: "no cmd/commands/parallel" } }), { status: 400, headers: { "content-type": "application/json" } });
    },
  });

  if (opts.id) {
    registerDaemon({ id: opts.id, port, mode: opts.mode ?? "headless", route: opts.route, pid: process.pid });
  }

  return { controller, http, chrome, vaultSocket, vaultUi, vault, sharedVault };
}

export async function stopDaemon(d: Daemon): Promise<void> {
  d.http.stop();
  await d.vaultUi.close();
  d.vault.lock();
  await d.vaultSocket.close();
  await d.sharedVault?.close();
  d.controller && d.controller.session.close();
  closeChrome(d.chrome);
}

export function healthUrl(port = PORT): string {
  return `http://127.0.0.1:${port}`;
}

export async function daemonHealthy(port = PORT): Promise<boolean> {
  try {
    const r = await fetch(`${healthUrl(port)}/healthz`);
    return r.ok;
  } catch {
    return false;
  }
}

export type DaemonResult =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; hint?: string } };

async function proxy(port: number, cmd: CommandLike): Promise<DaemonResult> {
  const r = await fetch(`${healthUrl(port)}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const json = (await r.json()) as DaemonResult;
  return json;
}

export async function run(cmd: CommandLike, id?: string): Promise<unknown> {
  const dRes = await dispatch(cmd, id);
  if (dRes.ok) return dRes.result;
  const err = new UnaError(dRes.error.code as ErrorCode, dRes.error.message, dRes.error.hint);
  throw err;
}

type CommandLike = { commands?: string[]; cmd?: string; parallel?: unknown };

async function dispatch(cmd: CommandLike, id?: string): Promise<DaemonResult> {
  const port = id ? (daemonPortOf(id) ?? idPort(id)) : PORT;
  if (await daemonHealthy(port)) {
    try { return await proxy(port, cmd); } catch { /* fall back to one-shot */ }
  }
  return runOneShot(cmd, id);
}

async function runOneShot(cmd: CommandLike, id?: string): Promise<DaemonResult> {
  const chrome = await launchChrome({ id, userDataDir: id ? undefined : profileDir("default") });
  try {
    const session = await PageSession.connect(chrome.port);
    const controller = new Controller(session, new TabManager(chrome.port, firstSlot(session)));
    try {
      if (cmd.cmd !== undefined) {
        const c = parseArgs(cmd.cmd.trim().split(/\s+/));
        return { ok: true, result: await controller.exec(c) };
      }
      if (cmd.parallel !== undefined) {
        const { normalizeJobs } = await import("./parallel/tabs");
        const jobs = normalizeJobs(cmd.parallel);
        return { ok: true, result: await controller.parallelJobs(jobs) };
      }
      const { runBatch } = await import("./parallel/batch");
      return { ok: true, result: await runBatch(controller, cmd.commands ?? []) };
    } finally {
      session.close();
    }
  } finally {
    closeChrome(chrome);
  }
}

export async function startDaemonForever(caller: string, opts: ServeOpts = {}): Promise<never> {
  const port = opts.id ? (daemonPortOf(opts.id) ?? idPort(opts.id)) : PORT;
  const d = await startDaemon(port, opts);
  console.error(`[una] daemon (${caller}) on ${healthUrl(port)} — owning browser ${d.chrome.port}${d.chrome.userDataDir ? ` (profile ${d.chrome.userDataDir})` : ""}`);
  // keep alive forever
  await new Promise<never>(() => {});
  return undefined as never;
}

function headlessForUa(mode: HarnessMode | undefined): boolean {
  return mode === undefined || mode === "headless";
}

async function applyProfileUa(session: PageSession, id: string): Promise<void> {
  const { readFileSync } = await import("node:fs");
  try {
    const ua = readFileSync(profileUaPath(id), "utf8").trim();
    if (!ua) return;
    await session.client.send("Network.enable", {});
    await session.client.send("Network.setUserAgentOverride", { userAgent: ua });
  } catch { /* no UA file → inherit Chrome default */ }
}
