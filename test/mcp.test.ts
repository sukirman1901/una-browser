import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "bun";
import { startDaemon, stopDaemon, healthUrl, type Daemon } from "../src/serve";
import { startFixture } from "./server";
import type { Server } from "bun";

let daemon: Daemon | undefined;
let server: Server<undefined>;
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
  server = await startFixture(0);
  daemon = await startDaemon(PORT);
});

afterAll(async () => {
  if (daemon) await stopDaemon(daemon);
  server?.stop();
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

  it("unknown tool → error, not crash", async () => {
    const proc = start(PORT);
    await handshake(proc);
    await call(proc, 20, "nope", {});
    const res = JSON.parse(await nextReply(proc.stdout));
    expect(res.error.code).toBe(-32602);
    proc.kill();
  });
});