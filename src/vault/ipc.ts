import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { Credential } from "./store";
import type { VaultManager } from "./manager";

export type VaultRequest =
  | { action: "init" | "unlock"; passphrase: string }
  | { action: "add"; credential: Credential }
  | { action: "edit"; id: string; credential: Credential }
  | { action: "delete"; id: string }
  | { action: "lock" | "list" | "status" };
export type VaultReply = { ok: boolean; result?: unknown; error?: string };

export function vaultSocketPath(root: string, port: number): string {
  return path.join(root, "vault", `control-${port}.sock`);
}

function ensurePrivateDirectory(root: string): void {
  const dir = path.join(root, "vault");
  if (fs.existsSync(dir) && (fs.lstatSync(dir).isSymbolicLink() || !fs.lstatSync(dir).isDirectory())) throw new Error("unsafe vault directory");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.statSync(dir).mode & 0o077) throw new Error("unsafe vault permissions");
}

export async function startVaultSocket(manager: VaultManager, root: string, port: number): Promise<{ close: () => Promise<void> }> {
  ensurePrivateDirectory(root);
  const socketPath = vaultSocketPath(root, port);
  if (fs.existsSync(socketPath)) {
    await recoverStaleSocket(socketPath);
    if (fs.existsSync(socketPath)) throw new Error("vault socket already exists; stop the stale daemon before retrying");
  }
  const server = net.createServer((socket) => {
    let text = "";
    socket.setTimeout(10_000, () => socket.destroy());
    socket.on("data", (chunk) => {
      text += chunk.toString("utf8");
      if (text.length > 64 * 1024) { socket.destroy(); return; }
      const end = text.indexOf("\n");
      if (end < 0) return;
      const line = text.slice(0, end);
      text = "";
      let reply: VaultReply;
      try {
        const command = JSON.parse(line) as VaultRequest;
        switch (command.action) {
          case "init": manager.init(command.passphrase); reply = { ok: true }; break;
          case "unlock": manager.unlock(command.passphrase); reply = { ok: true }; break;
          case "lock": manager.lock(); reply = { ok: true }; break;
          case "add": manager.add(command.credential); reply = { ok: true }; break;
          case "edit": manager.edit(command.id, command.credential); reply = { ok: true }; break;
          case "delete": manager.delete(command.id); reply = { ok: true }; break;
          case "list": reply = { ok: true, result: manager.list() }; break;
          case "status": reply = { ok: true, result: { unlocked: manager.isUnlocked() } }; break;
          default: reply = { ok: false, error: "unknown vault operation" };
        }
      } catch { reply = { ok: false, error: "vault operation failed (check lock, passphrase, and input)" }; }
      socket.end(JSON.stringify(reply) + "\n");
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
    fs.chmodSync(socketPath, 0o600);
  } catch (error) { server.close(); throw error; }
  return { close: () => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath); error ? reject(error) : resolve(); });
  }) };
}

/** Remove a leftover socket file only after verifying it is a stale Unix socket with no live listener behind it. */
async function recoverStaleSocket(socketPath: string): Promise<void> {
  let stats;
  try {
    stats = fs.lstatSync(socketPath);
  } catch {
    return; // gone between existsSync and lstat; nothing to recover
  }
  if (stats.isSymbolicLink() || !stats.isSocket()) return; // never follow or delete foreign paths
  const live = await new Promise<boolean>((resolve) => {
    const client = net.createConnection(socketPath);
    const settle = (result: boolean) => {
      client.destroy();
      resolve(result);
    };
    client.once("connect", () => settle(true));
    client.once("error", (error) => settle(false));
  });
  if (live) return; // a daemon still owns this socket
  try {
    fs.unlinkSync(socketPath);
  } catch { /* auto-cleaned by the OS or already gone */ }
}

export async function sendVaultRequest(root: string, port: number, request: VaultRequest): Promise<VaultReply> {
  const socketPath = vaultSocketPath(root, port);
  if (!fs.existsSync(socketPath) || fs.lstatSync(socketPath).isSymbolicLink() || (fs.lstatSync(socketPath).mode & 0o077)) {
    throw new Error("private vault socket unavailable");
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let output = "";
    socket.setTimeout(10_000, () => socket.destroy(new Error("vault request timed out")));
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 64 * 1024) { socket.destroy(new Error("vault response too large")); return; }
      if (output.includes("\n")) { socket.end(); resolve(JSON.parse(output.slice(0, output.indexOf("\n"))) as VaultReply); }
    });
    socket.once("error", reject);
  });
}
