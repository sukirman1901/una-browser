import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";
import type { Server } from "bun";
import { startDaemon, stopDaemon, type Daemon } from "../src/serve";

// Synthetic end-to-end flow: MCP vault_open → UI setup/unlock/add over plain
// HTTP (the "ordinary browser") → vault_fill on a separate synthetic HTTPS
// fixture. No real credentials anywhere; MCP text must stay secret-free.

const MASTER = "synthetic-master";
const PASSWORD = "synthetic-password";
const USERNAME = "synthetic-user@example.org";
const NOTES = "synthetic-note";

let root: string;
let certDir: string;
let daemon: Daemon;
let login: Server<undefined>;
let httpsPort = 0;
let mcp: { send(msg: unknown): Promise<void>; next(): Promise<Line>; close(): void } | undefined;
let transcript: string[] = [];

interface Line {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "una-e2e-"));
  certDir = mkdtempSync(join(tmpdir(), "una-e2e-cert-"));
  const gen = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"), "-days", "2", "-nodes", "-subj", "/CN=127.0.0.1"]);
  login = Bun.serve({
    port: 0,
    tls: gen.status === 0 ? {
      key: Bun.file(join(certDir, "key.pem")),
      cert: Bun.file(join(certDir, "cert.pem")),
    } : undefined,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/login") {
        return new Response(`<!doctype html><html><head><title>Synth Login</title></head><body><form><input id="username" name="username"><input id="password" type="password" name="password"><button type="submit">Sign in</button></form></body></html>`, { headers: { "content-type": "text/html" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  httpsPort = login.port ?? 0;
  if (!httpsPort) throw new Error("HTTPS fixture did not start");
  process.env.UNA_ROOT = root;
  daemon = await startDaemon(27300 + Math.floor(Math.random() * 400));
});

afterAll(async () => {
  await stopDaemon(daemon).catch(() => {});
  mcp?.close();
  login?.stop();
  delete (process.env as Record<string, string | undefined>).UNA_ROOT;
  for (const dir of [root, certDir]) if (dir) rmSync(dir, { recursive: true, force: true });
});

function connectMcp() {
  const proc = spawn({
    cmd: ["bun", "src/mcp/server.ts"],
    env: { ...process.env, UNA_ROOT: root, UNA_PORT: String(daemon.http.port ?? 0), UNA_MCP_MAIN: "1", UNA_MODE: process.env.UNA_MODE ?? "" },
    stdin: "pipe", stdout: "pipe", stderr: "ignore",
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  mcp = {
    async send(msg: unknown) { proc.stdin.write(JSON.stringify(msg) + "\n"); await proc.stdin.flush(); },
    async next(): Promise<Line> {
      while (!buf.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("mcp closed");
        buf += decoder.decode(value);
      }
      const line = buf.slice(0, buf.indexOf("\n"));
      buf = buf.slice(buf.indexOf("\n") + 1);
      const parsed = JSON.parse(line) as Line;
      transcript.push(line);
      return parsed;
    },
    close() { proc.kill(); reader.releaseLock(); },
  };
  return mcp;
}

const note = (value: unknown) => JSON.stringify(value ?? null);

function sessionCookie(response: Response): string {
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function formPost(path: string, fields: Record<string, string>, cookie: string): Promise<Response> {
  const response = await fetch(new URL(path, daemon.vaultUi.url), {
    method: "POST", redirect: "manual",
    headers: { Cookie: cookie, Origin: new URL(daemon.vaultUi.url).origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const rotated = sessionCookie(response);
  // Rotation on init/unlock must carry the NEW cookie forward for the
  // remaining "human browser" steps, exactly like a real browser would.
  if (rotated) browserCookie = rotated;
  return response;
}
let browserCookie = "";

test("open link → UI setup → synthetic credential → vault_fill, without secrets in MCP text", async () => {
  if (spawnSync("openssl", ["version"]).status !== 0) return; // no openssl; skip gracefully
  const c = connectMcp();
  await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
  await c.next();
  await c.send({ jsonrpc: "2.0", method: "notifications/initialized" });

  // 1. agent asks for the vault link; the test takes the role of the ordinary browser
  await c.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vault_open", arguments: {} } });
  const opened = await c.next();
  const link = JSON.stringify(opened.result).match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
  expect(link).toBe(daemon.vaultUi.url);

  // 2. human browser: create the vault and add a synthetic login through the UI
  const page = await fetch(daemon.vaultUi.url);
  browserCookie = sessionCookie(page);
  const html = await page.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1]!;
  expect((await formPost("/vault/init", { csrf, passphrase: MASTER, confirm: MASTER }, browserCookie)).status).toBe(303);
  const next = await fetch(daemon.vaultUi.url, { headers: { Cookie: browserCookie } });
  const nextHtml = await next.text();
  const add = await formPost("/vault/add", { csrf: nextHtml.match(/name="csrf" value="([^"]+)"/)![1], website: `https://127.0.0.1:${httpsPort}`, username: USERNAME, password: PASSWORD, notes: NOTES }, browserCookie);
  expect(add.status).toBe(303);

  // 3. agent side: verify status and fill the synthetic HTTPS login form
  await c.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "vault_status", arguments: {} } });
  const status = await c.next();
  expect(JSON.parse(String((status.result as { content: { text: string }[] }).content[0].text))).toEqual({ unlocked: true });
  await daemon.controller.session.client.send("Security.setIgnoreCertificateErrors", { ignore: true });
  await c.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "open", arguments: { url: `https://127.0.0.1:${httpsPort}/login` } } });
  await c.next();
  await c.send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "vault_fill", arguments: {} } });
  const fill = await c.next();
  const fillText = String((fill.result as { content: { text: string }[] }).content[0].text);
  expect(fillText).toContain('"filled":true');
  expect(fillText).not.toContain(PASSWORD);
  expect(fillText).not.toContain(NOTES);
  expect(fillText).not.toContain(USERNAME);
  expect(fillText).not.toContain(MASTER);

  // 4. documented boundary check: eval CAN read filled values — prove the fill landed
  await c.send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "eval", arguments: { expr: "document.getElementById('password').value" } } });
  const value = await c.next();
  expect((JSON.parse(String((value.result as { content: { text: string }[] }).content[0].text)) as { value: string }).value).toBe(PASSWORD);

  // 5. agent-facing MCP traffic (everything except the boundary-proof eval) stayed secret-free
  for (const line of transcript) {
    if (line.includes('"id":6')) continue; // eval boundary check, documented above
    expect(note(line)).not.toContain(PASSWORD);
    expect(note(line)).not.toContain(NOTES);
    expect(note(line)).not.toContain(MASTER);
  }

  // 6. query strings and UI HTML stay secret-free end to end
  for (const url of [daemon.vaultUi.url, `https://127.0.0.1:${httpsPort}/login`]) {
    expect(note(url)).not.toContain(PASSWORD);
    expect(note(url)).not.toContain(MASTER);
  }
  const finalHtml = await (await fetch(daemon.vaultUi.url, { headers: { Cookie: browserCookie } })).text();
  expect(finalHtml).not.toContain(PASSWORD);
  expect(finalHtml).not.toContain(NOTES);
});
