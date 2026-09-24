import type { Server } from "bun";
import { launchChrome, closeChrome, type LaunchedChrome } from "./cdp/launcher";
import { PageSession } from "./cdp/session";
import { Controller } from "./actions/exec";
import { parseArgs } from "./args";
import { UnaError, type ErrorCode } from "./errors";

const PORT = Number(process.env.UNA_PORT ?? 17911);

export interface Daemon {
  controller: Controller;
  http: Server<undefined>;
  chrome: LaunchedChrome;
}

export async function startDaemon(port = PORT): Promise<Daemon> {
  const chrome = await launchChrome();
  const session = await PageSession.connect(chrome.port);
  const controller = new Controller(session);

  const http = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/healthz") {
        const sess = (controller as unknown as { session: PageSession }).session;
        return new Response(JSON.stringify({ ok: true, url: await sess.current() }), { headers: { "content-type": "application/json" } });
      }
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body: { commands?: string[]; cmd?: string };
      try {
        body = (await req.json()) as { commands?: string[]; cmd?: string };
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
      return new Response(JSON.stringify({ ok: false, error: { code: "grammar", message: "no cmd/commands" } }), { status: 400, headers: { "content-type": "application/json" } });
    },
  });

  return { controller, http, chrome };
}

export async function stopDaemon(d: Daemon): Promise<void> {
  d.http.stop();
  d.controller && (d.controller as unknown as { session: PageSession }).session.close();
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

async function proxy(port: number, cmd: { commands?: string[]; cmd?: string }): Promise<DaemonResult> {
  const r = await fetch(`${healthUrl(port)}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const json = (await r.json()) as DaemonResult;
  return json;
}

async function runOneShot(cmd: { commands?: string[]; cmd?: string }): Promise<DaemonResult> {
  const chrome = await launchChrome();
  try {
    const session = await PageSession.connect(chrome.port);
    const controller = new Controller(session);
    try {
      if (cmd.cmd !== undefined) {
        const c = parseArgs(cmd.cmd.trim().split(/\s+/));
        return { ok: true, result: await controller.exec(c) };
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

export async function run(cmd: CommandLike): Promise<unknown> {
  const dRes = await dispatch(cmd);
  if (dRes.ok) return dRes.result;
  const err = new UnaError(dRes.error.code as ErrorCode, dRes.error.message, dRes.error.hint);
  throw err;
}

type CommandLike = { commands?: string[]; cmd?: string };

async function dispatch(cmd: CommandLike): Promise<DaemonResult> {
  if (await daemonHealthy()) {
    try { return await proxy(PORT, cmd); } catch { /* fall back to one-shot */ }
  }
  return runOneShot(cmd);
}

export async function startDaemonForever(caller: string): Promise<never> {
  const d = await startDaemon();
  console.error(`[una] daemon (${caller}) on ${healthUrl()} — owning browser ${d.chrome.port}${d.chrome.userDataDir ? ` (profile ${d.chrome.userDataDir})` : ""}`);
  // keep alive forever
  await new Promise<never>(() => {});
  return undefined as never;
}
