import { beforeAll, afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "bun";
import { startDaemon, stopDaemon, type Daemon } from "../src/serve";
import { sendVaultRequest } from "../src/vault/ipc";

let root: string;
let server: Server<undefined>;
let httpServer: Server<undefined>;
let daemon: Daemon;
let origin: string;
const PORT = 19800 + Math.floor(Math.random() * 300);
const password = "synthetic-vault-password";

async function command(cmd: string): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }> {
  const response = await fetch(`http://127.0.0.1:${PORT}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd }) });
  return response.json() as Promise<{ ok: boolean; result?: unknown; error?: { message: string } }>;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "una-vault-fill-"));
  process.env.UNA_ROOT = root;
  const key = join(root, "key.pem"), cert = join(root, "cert.pem");
  const generated = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-days", "1", "-addext", "subjectAltName=IP:127.0.0.1"]);
  if (generated.exitCode !== 0) throw new Error("openssl fixture certificate generation failed");
  server = Bun.serve({ port: 0, tls: { key: Bun.file(key), cert: Bun.file(cert) }, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/ambiguous") return new Response('<form><input type="email" name="email"><input type="password" name="first"><input type="password" name="second"></form>', { headers: { "content-type": "text/html" } });
    return new Response('<form id="login" onsubmit="document.body.dataset.submitted=\'yes\';return false"><input type="email" name="email"><input type="password" name="password"><button type="submit">Sign in</button></form>', { headers: { "content-type": "text/html" } });
  } });
  httpServer = Bun.serve({ port: 0, fetch: () => new Response("<p>HTTP fixture</p>", { headers: { "content-type": "text/html" } }) });
  origin = `https://127.0.0.1:${server.port}`;
  daemon = await startDaemon(PORT);
  await daemon.controller.session.client.send("Security.setIgnoreCertificateErrors", { ignore: true });
  await sendVaultRequest(root, PORT, { action: "init", passphrase: "synthetic-master" });
  await sendVaultRequest(root, PORT, { action: "add", credential: { website: origin, username: "synthetic@example.org", password, notes: "private fixture note" } });
});

afterAll(async () => {
  if (daemon) await stopDaemon(daemon);
  server?.stop();
  httpServer?.stop();
  delete process.env.UNA_ROOT;
  if (root) rmSync(root, { recursive: true, force: true });
});

test("fills one matching HTTPS login without submitting or returning credentials", async () => {
  await command(`open ${origin}/login`);
  const filled = await command("vault fill");
  expect(filled.ok).toBe(true);
  expect(JSON.stringify(filled)).not.toContain(password);
  expect(JSON.stringify(filled)).not.toContain("synthetic@example.org");
  const values = await daemon.controller.session.client.send("Runtime.evaluate", { expression: "({user:document.querySelector('[type=email]').value,pass:document.querySelector('[type=password]').value,submitted:document.body.dataset.submitted||null})", returnByValue: true });
  expect((values.result as { value: unknown }).value).toEqual({ user: "synthetic@example.org", pass: password, submitted: null });
});

test("rejects ambiguous login forms before inserting anything", async () => {
  await command(`open ${origin}/ambiguous`);
  const filled = await command("vault fill");
  expect(filled.ok).toBe(false);
  const values = await daemon.controller.session.client.send("Runtime.evaluate", { expression: "Array.from(document.querySelectorAll('input')).map(i=>i.value)", returnByValue: true });
  expect((values.result as { value: string[] }).value).toEqual(["", "", ""]);
});

test("rejects HTTP and other HTTPS origins and multiple accounts without selector", async () => {
  expect((await command("vault status")).ok).toBe(true);
  await command(`open http://127.0.0.1:${httpServer.port}/`);
  expect((await command("vault fill")).ok).toBe(false);
  await command(`open https://localhost:${server.port}/login`);
  expect((await command("vault fill")).ok).toBe(false);
  await command(`open ${origin}/login`);
  await sendVaultRequest(root, PORT, { action: "add", credential: { website: origin, username: "another@example.org", password: "another-synthetic", notes: "" } });
  expect((await command("vault fill")).ok).toBe(false);
  const list = await command("vault list");
  expect(JSON.stringify(list)).not.toContain(password);
  const accounts = list.result as Array<{ id: string; username: string }>;
  const selected = accounts.find((x) => x.username === "synthetic@example.org")!;
  expect((await command(`vault fill ${selected.id}`)).ok).toBe(true);
  await sendVaultRequest(root, PORT, { action: "lock" });
  expect((await command(`vault fill ${selected.id}`)).ok).toBe(false);
});
