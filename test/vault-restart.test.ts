import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as net from "node:net";
import { VaultManager } from "../src/vault/manager";
import { startVaultSocket, vaultSocketPath, sendVaultRequest } from "../src/vault/ipc";
import { startDaemon, stopDaemon } from "../src/serve";

const roots: string[] = [];
function isolated() { const root = mkdtempSync(join(tmpdir(), "una-restart-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("stale Unix socket is recovered, but an active socket is never replaced", async () => {
  if (process.platform === "win32") return;
  const root = isolated();
  const path = vaultSocketPath(root, 19563);
  mkdirSync(join(root, "vault"), { mode: 0o700 });
  const child = Bun.spawn(["bun", "-e", `const net=require('node:net');const server=net.createServer();server.listen(${JSON.stringify(path)},()=>{require('node:fs').chmodSync(${JSON.stringify(path)},0o600);console.log('ready')});`], { stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader();
    await reader.read();
    reader.releaseLock();
    expect(lstatSync(path).isSocket()).toBe(true);
  } finally { child.kill("SIGKILL"); await child.exited; }
  expect(existsSync(path)).toBe(true);
  const manager = new VaultManager(root);
  const recovered = await startVaultSocket(manager, root, 19563);
  try {
    expect(await sendVaultRequest(root, 19563, { action: "status" })).toEqual({ ok: true, result: { unlocked: false } });
    await expect(startVaultSocket(new VaultManager(root), root, 19563)).rejects.toThrow();
    expect(lstatSync(path).isSocket()).toBe(true);
  } finally { await recovered.close(); }
});

test("refuses to unlink another file at the socket path", async () => {
  if (process.platform === "win32") return;
  const root = isolated();
  const path = vaultSocketPath(root, 19564);
  mkdirSync(join(root, "vault"), { mode: 0o700 });
  writeFileSync(path, "do-not-delete", { mode: 0o600 });
  await expect(startVaultSocket(new VaultManager(root), root, 19564)).rejects.toThrow();
  expect(Bun.file(path).text()).resolves.toBe("do-not-delete");
});

test("failed daemon start releases Chrome and its first socket", async () => {
  const root = isolated();
  const old = process.env.UNA_ROOT;
  process.env.UNA_ROOT = root;
  const port = 26100 + Math.floor(Math.random() * 1000);
  const occupied = net.createServer();
  await new Promise<void>((resolve) => occupied.listen(port, "127.0.0.1", resolve));
  try {
    await expect(startDaemon(port)).rejects.toThrow();
    expect(existsSync(vaultSocketPath(root, port))).toBe(false);
  } finally {
    occupied.close();
    if (old === undefined) delete process.env.UNA_ROOT;
    else process.env.UNA_ROOT = old;
  }
});

test("graceful stop closes UI and vault socket and clears key", async () => {
  const root = isolated();
  const old = process.env.UNA_ROOT;
  process.env.UNA_ROOT = root;
  const port = 27200 + Math.floor(Math.random() * 1000);
  try {
    const d = await startDaemon(port);
    const url = d.vaultUi.url;
    d.vault.init("synthetic-master");
    await stopDaemon(d);
    expect(d.vault.isUnlocked()).toBe(false);
    expect(existsSync(vaultSocketPath(root, port))).toBe(false);
    expect(fetch(url)).rejects.toThrow();
  } finally {
    if (old === undefined) delete process.env.UNA_ROOT;
    else process.env.UNA_ROOT = old;
  }
});
