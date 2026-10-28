import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";
import { startDaemon, stopDaemon, type Daemon } from "../src/serve";

const root = mkdtempSync(join(tmpdir(), "una-mcp-ui-"));
const port = 24500 + Math.floor(Math.random() * 1000);
let daemon: Daemon;
const oldRoot = process.env.UNA_ROOT;
beforeAll(async () => { process.env.UNA_ROOT = root; daemon = await startDaemon(port); });
afterAll(async () => {
  await stopDaemon(daemon);
  if (oldRoot === undefined) delete process.env.UNA_ROOT;
  else process.env.UNA_ROOT = oldRoot;
  rmSync(root, { recursive: true, force: true });
});

function client(capabilities: Record<string, unknown> = {}, protocolVersion = "2025-03-26") {
  const proc = spawn({ cmd: ["bun", "src/mcp/server.ts"], env: { ...process.env, UNA_ROOT: root, UNA_PORT: String(port), UNA_MCP_MAIN: "1" }, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async send(msg: unknown) { proc.stdin.write(JSON.stringify(msg) + "\n"); await proc.stdin.flush(); },
    async next() {
      while (!buffer.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("MCP process closed");
        buffer += decoder.decode(value);
      }
      const [line, ...rest] = buffer.split("\n");
      buffer = rest.join("\n");
      return JSON.parse(line!) as { id: number; result?: Record<string, unknown>; error?: Record<string, unknown>; method?: string; params?: Record<string, unknown> };
    },
    async init() {
      await this.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities, clientInfo: { name: "test", version: "1" } } });
      const response = await this.next();
      await this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return response;
    },
    close() { proc.kill(); reader.releaseLock(); },
  };
}

test("legacy clients receive only a nonsecret loopback link, without form elicitation", async () => {
  const c = client();
  try {
    await c.init();
    await c.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vault_open", arguments: {} } });
    const reply = await c.next();
    expect(reply.id).toBe(2);
    const text = JSON.stringify(reply.result);
    expect(text).toContain(daemon.vaultUi.url);
    expect(text).not.toContain("passphrase");
    expect(text).not.toContain("password");
    expect(text).not.toContain("?token=");
  } finally { c.close(); }
});

test("URL-capable client gets URL-mode elicitation and tool result after consent", async () => {
  const c = client({ elicitation: { url: {} } }, "2025-11-25");
  try {
    const init = await c.init();
    expect(init.result?.protocolVersion).toBe("2025-11-25");
    await c.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vault_open", arguments: {} } });
    const request = await c.next();
    expect(request.method).toBe("elicitation/create");
    expect(request.params).toMatchObject({ mode: "url", url: daemon.vaultUi.url });
    expect(typeof request.params?.elicitationId).toBe("string");
    expect(JSON.stringify(request)).not.toContain("passphrase");
    await c.send({ jsonrpc: "2.0", id: request.id, result: { action: "accept" } });
    const done = await c.next();
    expect(done.id).toBe(2);
    expect(JSON.stringify(done.result)).toContain(daemon.vaultUi.url);
  } finally { c.close(); }
});

test("URL elicitation decline is respected without opening una's Chrome", async () => {
  const c = client({ elicitation: { url: {} } }, "2025-11-25");
  try {
    await c.init();
    const before = await daemon.controller.session.current();
    await c.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "vault_open", arguments: {} } });
    const request = await c.next();
    await c.send({ jsonrpc: "2.0", id: request.id, result: { action: "decline" } });
    const done = await c.next();
    expect(JSON.stringify(done.result)).toContain("cancelled");
    expect(await daemon.controller.session.current()).toEqual(before);
  } finally { c.close(); }
});

test("client cancellation stops the outstanding URL request", async () => {
  const c = client({ elicitation: { url: {} } }, "2025-11-25");
  try {
    await c.init();
    await c.send({ jsonrpc: "2.0", id: 23, method: "tools/call", params: { name: "vault_open", arguments: {} } });
    const request = await c.next();
    expect(request.method).toBe("elicitation/create");
    await c.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 23, reason: "user cancelled" } });
    const response = await c.next();
    expect(response.id).toBe(23);
    expect(JSON.stringify(response.result)).toContain("cancelled");
  } finally { c.close(); }
});
