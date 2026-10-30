import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon, stopDaemon, healthUrl, type Daemon } from "../src/serve";
import { startFixture } from "./server";
import type { Server } from "bun";

let daemon: Daemon | undefined;
let server: Server<undefined>;
let root = "";
const PORT = 18500 + Math.floor(Math.random() * 400);

interface PipeProc {
  stdin: import("bun").FileSink;
  stdout: ReadableStream;
  kill: (code?: number) => void;
}

function start(port: number): PipeProc {
  const proc = spawn({
    cmd: ["bun", "src/mcp/server.ts"],
    env: { ...process.env, UNA_MCP_MAIN: "1", UNA_PORT: String(port) },
    stdin: "pipe", stdout: "pipe", stderr: "ignore",
  });
  return { stdin: proc.stdin as never, stdout: proc.stdout as never, kill: (c?: number) => proc.kill(c) };
}

async function handshake(proc: PipeProc) {
  proc.stdin!.write(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) + "\n" +
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
  );
  await proc.stdin!.flush();
  const init = JSON.parse(await nextReply(proc.stdout));
  expect(init.result.serverInfo.name).toBe("una");
}

async function call(proc: PipeProc, id: number, name: string, args: Record<string, unknown>) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
  await proc.stdin.flush();
}

function nextReply(readable: ReadableStream): Promise<string> {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  return (async () => {
    for (;;) {
      if (buf.includes("\n")) {
        const line = buf.slice(0, buf.indexOf("\n"));
        buf = buf.slice(buf.indexOf("\n") + 1);
        reader.releaseLock();
        return line;
      }
      const { done, value } = await reader.read();
      if (done) return buf;
      buf += decoder.decode(value, { stream: true });
    }
  })();
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "una-mcp-"));
  process.env.UNA_ROOT = root;
  server = await startFixture(0);
  daemon = await startDaemon(PORT);
});

afterAll(async () => {
  if (daemon) await stopDaemon(daemon);
  server?.stop();
  delete process.env.UNA_ROOT;
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("una-mcp", () => {
  it("handshake + tools/list advertise verbs", async () => {
    const proc = start(PORT);
    await handshake(proc);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    await proc.stdin.flush();
    const list = JSON.parse(await nextReply(proc.stdout));
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("open");
    expect(names).toContain("snap");
    expect(names).toContain("click");
    expect(names).toContain("batch");
    expect(names).toContain("attach");
    expect(names).toContain("press");
    expect(names).toContain("eval");
    expect(names).toContain("tab");
    expect(names).toContain("tabs");
    expect(names).toContain("switch");
    expect(names).toContain("close");
    expect(names).toContain("parallel");
    expect(names).toContain("fuse");
    expect(names).toContain("vault_status");
    expect(names).toContain("vault_list");
    expect(names).toContain("vault_fill");
    expect(names).toContain("vision_observe");
    expect(names).toContain("vision_click");
    const waitTool = list.result.tools.find((t: { name: string }) => t.name === "wait");
    expect(waitTool.inputSchema.properties.timeout).toMatchObject({ type: "number", minimum: 0 });
    expect(names.some((name: string) => /vault_(init|add|unlock|edit|delete)/.test(name))).toBe(false);
    proc.kill();
  });

  it("vault status is nonsecret and sensitive vault management is not a tool", async () => {
    const proc = start(PORT);
    await handshake(proc);
    await call(proc, 80, "vault_status", {});
    const status = JSON.parse(await nextReply(proc.stdout));
    expect(status.result.content[0].text).toContain('"unlocked":false');
    await call(proc, 81, "vault_unlock", { passphrase: "synthetic-secret" });
    const rejected = JSON.parse(await nextReply(proc.stdout));
    expect(rejected.error.code).toBe(-32602);
    expect(JSON.stringify(rejected)).not.toContain("synthetic-secret");
    proc.kill();
  });

  it("vault_fill never discloses credentials when current page is HTTP", async () => {
    const proc = start(PORT);
    await handshake(proc);
    await call(proc, 82, "open", { url: `http://127.0.0.1:${server.port}/` });
    await nextReply(proc.stdout);
    await call(proc, 83, "vault_fill", {});
    const denied = JSON.parse(await nextReply(proc.stdout));
    expect(denied.result.isError).toBe(true);
    expect(JSON.stringify(denied)).not.toContain("password");
    proc.kill();
  });

  it("tools/call proxies to the daemon", async () => {
    const proc = start(PORT);
    await handshake(proc);
    await call(proc, 10, "open", { url: `http://127.0.0.1:${server.port}/` });
    const open = JSON.parse(await nextReply(proc.stdout));
    expect(open.result.content[0].text).toContain("UnaFixture");

    await call(proc, 11, "snap", { compact: true });
    const snap = JSON.parse(await nextReply(proc.stdout));
    expect(snap.result.content[0].text).toContain("@e");
    expect(snap.result.content[0].text).toContain("Una Fixture");

    await call(proc, 12, "check", { rule: 'text="Una Fixture"' });
    const check = JSON.parse(await nextReply(proc.stdout));
    expect(check.result.content[0].text).toContain('"verdict":"PASS"');
    proc.kill();
  });

  it("vision returns image content to the active model and clicks the observed iframe", async () => {
    const proc = start(PORT);
    try {
      await handshake(proc);
      await call(proc, 90, "open", { url: `http://127.0.0.1:${server.port}/vision-challenge` });
      await nextReply(proc.stdout);
      await call(proc, 91, "vision_observe", {});
      const observed = JSON.parse(await nextReply(proc.stdout));
      expect(observed.error).toBeUndefined();
      const [text, image] = observed.result.content;
      const meta = JSON.parse(text.text);
      expect(meta.state).toBe("challenge");
      expect(meta.data).toBeUndefined();
      expect(image.type).toBe("image");
      expect(image.mimeType).toBe("image/png");
      expect(Buffer.from(image.data, "base64").readUInt32BE(16)).toBe(meta.width);
      await call(proc, 92, "vision_click", { captureId: meta.captureId, x: 80 * meta.width / meta.viewport.width, y: 100 * meta.height / meta.viewport.height });
      const clicked = JSON.parse(await nextReply(proc.stdout));
      expect(JSON.parse(clicked.result.content[0].text)).toMatchObject({ clicked: true, requiresObservation: true });
      await call(proc, 93, "check", { rule: 'text="Fixture solved"' });
      const check = JSON.parse(await nextReply(proc.stdout));
      expect(JSON.parse(check.result.content[0].text).verdict).toBe("PASS");
    } finally { proc.kill(); }
  });

  it("bounded wait pauses without closing the daemon or challenge page, then resumes", async () => {
    const proc = start(PORT);
    try {
      await handshake(proc);
      await call(proc, 94, "open", { url: `http://127.0.0.1:${server.port}/vision-challenge` });
      await nextReply(proc.stdout);
      await call(proc, 95, "wait", { target: "resolve", timeout: 0 });
      const waited = JSON.parse(await nextReply(proc.stdout));
      expect(JSON.parse(waited.result.content[0].text)).toMatchObject({ outcome: "timed_out", state: "challenge" });
      expect((await fetch(`${healthUrl(PORT)}/healthz`)).ok).toBe(true);
      await call(proc, 96, "vision_observe", {});
      const observed = JSON.parse(await nextReply(proc.stdout));
      const meta = JSON.parse(observed.result.content[0].text);
      expect(meta.state).toBe("challenge");
      await call(proc, 97, "vision_click", { captureId: meta.captureId, x: 80 * meta.width / meta.viewport.width, y: 100 * meta.height / meta.viewport.height });
      expect(JSON.parse((JSON.parse(await nextReply(proc.stdout))).result.content[0].text)).toMatchObject({ clicked: true });
      await call(proc, 98, "wait", { target: "resolve", timeout: 1000 });
      const resumed = JSON.parse(await nextReply(proc.stdout));
      expect(JSON.parse(resumed.result.content[0].text)).toMatchObject({ outcome: "resolved", state: "loaded" });
    } finally { proc.kill(); }
  }, 15_000);

  it("forwards an explicit zero wait timeout instead of silently using the default", async () => {
    const receiver = Bun.serve({ port: 0, async fetch(req) {
      if (req.method === "GET") return Response.json({ ok: true });
      return Response.json({ ok: true, result: await req.json() });
    } });
    const proc = start(receiver.port!);
    try {
      await handshake(proc);
      await call(proc, 99, "wait", { target: "resolve", timeout: 0 });
      const result = JSON.parse(await nextReply(proc.stdout));
      expect(JSON.parse(result.result.content[0].text)).toEqual({ cmd: "wait resolve --timeout 0" });
    } finally { proc.kill(); receiver.stop(); }
  });

  it("una_tab opens a focused tab, una_tabs lists it", async () => {
    const proc = start(PORT);
    await handshake(proc);
    await call(proc, 30, "open", { url: `http://127.0.0.1:${server.port}/` });
    await nextReply(proc.stdout);

    await call(proc, 31, "tab", { url: `http://127.0.0.1:${server.port}/page2` });
    const tab = JSON.parse(await nextReply(proc.stdout));
    expect(tab.result.content[0].text).toContain('"title":"PageTwo"');
    expect(tab.result.content[0].text).toContain('"index":1');

    await call(proc, 32, "tabs", {});
    const tabs = JSON.parse(await nextReply(proc.stdout));
    const list = JSON.parse(tabs.result.content[0].text);
    expect(list.tabs).toHaveLength(2);
    expect(list.tabs[1].title).toBe("PageTwo");
    expect(list.tabs[1].active).toBe(true);
    proc.kill();
  });

  it("una_switch + una_close work through the daemon", async () => {
    const proc = start(PORT);
    await handshake(proc);
    await call(proc, 40, "switch", { target: "0" });
    const sw = JSON.parse(await nextReply(proc.stdout));
    expect(sw.result.content[0].text).toContain('"index":0');

    await call(proc, 41, "close", { index: 1 });
    const close = JSON.parse(await nextReply(proc.stdout));
    expect(close.result.content[0].text).toContain('"tabs":1');
    proc.kill();
  });

  it("una_parallel harvests and reports summary", async () => {
    const proc = start(PORT);
    await handshake(proc);
    await call(proc, 50, "parallel", { urls: [`http://127.0.0.1:${server.port}/`, `http://127.0.0.1:${server.port}/page2`], js: "() => document.querySelector('h1')?.textContent ?? document.title" });
    const res = JSON.parse(await nextReply(proc.stdout));
    const summary = JSON.parse(res.result.content[0].text);
    expect(summary.parallel).toBe(true);
    expect(summary.okCount).toBe(2);
    expect(summary.failed).toBe(0);
    const values = summary.results.map((r: { result?: unknown }) => r.result).sort();
    expect(values).toContain("Una Fixture");
    expect(values).toContain("Page Two");
    proc.kill();
  });

  it("una_fuse runs a one-pass chain", async () => {
    const proc = start(PORT);
    await handshake(proc);
    await call(proc, 60, "open", { url: `http://127.0.0.1:${server.port}/fuse` });
    await nextReply(proc.stdout);
    await call(proc, 61, "snap", { compact: true });
    const snap = JSON.parse(await nextReply(proc.stdout));
    const text = snap.result.content[0].text as string;
    const line = text.split("\n").find((l) => l.includes("Fused name"));
    const ref = line?.match(/@e\d+/)?.[0];
    expect(ref).toBeDefined();

    await call(proc, 62, "fuse", { commands: [`fill ${ref} Budi`, `check text="Fuse"`, `get ${ref}`] });
    const fused = JSON.parse(await nextReply(proc.stdout));
    expect(fused.result.content[0].text).toContain('"done":3');
    proc.kill();
  });

  it("unknown tool → error, not crash", async () => {
    const proc = start(PORT);
    await handshake(proc);
    await call(proc, 20, "nope", {});
    const res = JSON.parse(await nextReply(proc.stdout));
    expect(res.error.code).toBe(-32602);
    proc.kill();
  });
});
