import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon, stopDaemon, type Daemon } from "../src/serve";
import { sendVaultRequest } from "../src/vault/ipc";

let root: string;
let daemon: Daemon;
let site: ReturnType<typeof Bun.serve>;
const PORT = 20200 + Math.floor(Math.random() * 200);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "una-vault-e2e-"));
  process.env.UNA_ROOT = root;
  const key = join(root, "key.pem"), cert = join(root, "cert.pem");
  const generated = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-days", "1", "-addext", "subjectAltName=IP:127.0.0.1"]);
  if (generated.exitCode !== 0) throw new Error("openssl fixture certificate generation failed");
  site = Bun.serve({ port: 0, tls: { key: Bun.file(key), cert: Bun.file(cert) }, fetch: () => new Response('<form><input type="email"><input type="password"></form>', { headers: { "content-type": "text/html" } }) });
  daemon = await startDaemon(PORT);
  await daemon.controller.session.client.send("Security.setIgnoreCertificateErrors", { ignore: true });
});

afterAll(async () => {
  if (daemon) await stopDaemon(daemon);
  site?.stop();
  delete process.env.UNA_ROOT;
  if (root) rmSync(root, { recursive: true, force: true });
});

test("private unlock and MCP fill work together without returning the password", async () => {
  const origin = `https://127.0.0.1:${site.port}`;
  await sendVaultRequest(root, PORT, { action: "init", passphrase: "synthetic-master" });
  await sendVaultRequest(root, PORT, { action: "add", credential: { website: origin, username: "synthetic@example.org", password: "synthetic-e2e-password", notes: "private" } });
  const response = await fetch(`http://127.0.0.1:${PORT}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: `open ${origin}/` }) });
  expect(response.ok).toBe(true);

  const proc = Bun.spawn({ cmd: ["bun", "src/mcp/server.ts"], env: { ...process.env, UNA_MCP_MAIN: "1", UNA_PORT: String(PORT) }, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const reader = proc.stdout.getReader();
  try {
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "vault_fill", arguments: {} } }) + "\n");
    await proc.stdin.flush();
    const line = await reader.read();
    const result = JSON.parse(new TextDecoder().decode(line.value).trim());
    expect(result.result.isError).not.toBe(true);
    expect(JSON.stringify(result)).not.toContain("synthetic-e2e-password");
    const values = await daemon.controller.session.client.send("Runtime.evaluate", { expression: "[document.querySelector('[type=email]').value,document.querySelector('[type=password]').value]", returnByValue: true });
    expect((values.result as { value: string[] }).value).toEqual(["synthetic@example.org", "synthetic-e2e-password"]);
  } finally { reader.releaseLock(); proc.kill(); }
});
