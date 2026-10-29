import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { Credential } from "./store";
import type { VaultBinding, VaultManager } from "./manager";

export type VaultRequest =
  | { action: "init" | "unlock"; passphrase: string }
  | { action: "add"; credential: Credential }
  | { action: "edit"; id: string; credential: Credential }
  | { action: "delete"; id: string }
  | { action: "lock" | "list" | "status" }
  | { action: "get"; id: string }
  | { action: "ui-url" };
export type VaultReply = { ok: boolean; result?: unknown; error?: string };
export const SHARED_PORT = -1;

export function vaultSocketPath(root: string, port: number): string {
  return path.join(root, "vault", `control-${port}.sock`);
}

function ensurePrivateDirectory(root: string): void {
  const dir = path.join(root, "vault");
  if (fs.existsSync(dir) && (fs.lstatSync(dir).isSymbolicLink() || !fs.lstatSync(dir).isDirectory())) throw new Error("unsafe vault directory");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.statSync(dir).mode & 0o077) throw new Error("unsafe vault permissions");
}

export async function startVaultSocket(manager: VaultBinding, root: string, port: number, uiUrl?: () => string): Promise<{ close: () => Promise<void> }> {
  ensurePrivateDirectory(root);
  const socketPath = vaultSocketPath(root, port);
  // Elect the socket owner before touching the socket: without this, two daemons
  // probing a stale socket concurrently could both unlink and double-listen (split brain).
  const lock = await acquireOwnerLock(socketPath + ".lock");
  try {
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
        void (async () => {
          let reply: VaultReply;
          try {
            const command = JSON.parse(line) as VaultRequest;
            switch (command.action) {
              case "init": await manager.init(command.passphrase); reply = { ok: true }; break;
              case "unlock": await manager.unlock(command.passphrase); reply = { ok: true }; break;
              case "lock": await manager.lock(); reply = { ok: true }; break;
              case "add": await manager.add(command.credential); reply = { ok: true }; break;
              case "edit": await manager.edit(command.id, command.credential); reply = { ok: true }; break;
              case "delete": await manager.delete(command.id); reply = { ok: true }; break;
              case "list": reply = { ok: true, result: await manager.list() }; break;
              case "status": reply = { ok: true, result: { unlocked: await manager.isUnlocked() } }; break;
              // Passwords only cross the dedicated shared-socket, never per-daemon control sockets.
              case "get": reply = port === SHARED_PORT ? { ok: true, result: await manager.get(command.id) } : { ok: false, error: "unknown vault operation" }; break;
              case "ui-url": reply = port === SHARED_PORT ? { ok: true, result: uiUrl?.() } : { ok: false, error: "unknown vault operation" }; break;
              default: reply = { ok: false, error: "unknown vault operation" };
            }
          } catch { reply = { ok: false, error: "vault operation failed (check lock, passphrase, and input)" }; }
          socket.end(JSON.stringify(reply) + "\n");
        })();
      });
    });
    const bind = () => new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
    try {
      await bind();
      fs.chmodSync(socketPath, 0o600);
    } catch {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error("vault socket already exists; stop the stale daemon before retrying");
    }
    return { close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        lock.release();
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
        error ? reject(error) : resolve();
      });
    }) };
  } catch (error) {
    lock.release();
    throw error;
  }
}

interface OwnerLock { release(): void; }

/**
 * O_EXCL lockfile holding the owner pid: atomic create decides the election, pid
 * contents let competitors back off without inventing two owners after a crash.
 * (Bun has no flockSync; this is the portable equivalent, verified post-claim.)
 */
async function acquireOwnerLock(lockPath: string, attempts = 4, delayMs = 100): Promise<OwnerLock> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeSync(fd, String(process.pid));
        const claimed = fs.readFileSync(lockPath, "utf8");
        if (claimed === String(process.pid)) return { release: () => {
          try { fs.closeSync(fd); } catch { /* already closed */ }
          try { fs.unlinkSync(lockPath); } catch { /* a verified successor owns it now */ }
        } };
      } catch { /* read/write hiccup: fall through to conditional close */ }
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try { fs.unlinkSync(lockPath); } catch { /* gone already */ }
      throw new Error(`vault socket already exists; verify the pid claim in ${lockPath}`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "EEXIST") {
        if (error instanceof Error && error.message.includes("already exists")) throw error;
        throw error;
      }
      const holder = lockHolderPid(lockPath);
      if (holder !== null && processAlive(holder)) {
        throw new Error(`vault socket already exists; a live daemon (pid ${holder}) owns it`);
      }
      // stale claim: remove and retry the atomic create
      try { fs.unlinkSync(lockPath); } catch { /* gone already */ }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`vault socket already exists; lock contention on ${lockPath}`);
}

function lockHolderPid(lockPath: string): number | null {
  try {
    const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    // EPERM: the process exists but belongs to someone else — treat as alive.
    return (error as { code?: string }).code === "EPERM";
  }
}

/** The first daemon owns the unlocked key; later profiles borrow it over a private local socket. */
export async function connectSharedVault(manager: VaultManager, root: string, uiUrl?: () => string): Promise<{ vault: VaultBinding; owner: boolean; close: () => Promise<void> }> {
  try {
    const server = await startVaultSocket(manager, root, SHARED_PORT, uiUrl);
    return { vault: manager, owner: true, close: server.close };
  } catch (error) {
    // Covers both our own "vault socket already exists…" and a raw EADDRINUSE when two daemons race the existsSync check.
    const code = (error as { code?: string }).code;
    const transient = error instanceof Error && (error.message.includes("already exists") || error.message.includes("EADDRINUSE"));
    if (!transient && code !== "EADDRINUSE") throw error;
    const request = async (action: VaultRequest) => {
      const reply = await sendVaultRequest(root, SHARED_PORT, action);
      if (!reply.ok) throw new Error(reply.error ?? "vault operation failed");
      return reply.result;
    };
    // The owner may hold the election lock while its listener is still starting; let it finish.
    const deadline = Date.now() + 3_000;
    for (;;) {
      try { await request({ action: "status" }); break; }
      catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const vault: VaultBinding = {
      isUnlocked: async () => Boolean((await request({ action: "status" }) as { unlocked: boolean }).unlocked),
      getGeneration: () => 0,
      // Same shared data file under the daemon root; the owner never shares a symlinked path.
      exists: () => fs.existsSync(path.join(root, "vault", "data.json")),
      init: async (passphrase: string) => { await request({ action: "init", passphrase }); },
      unlock: async (passphrase: string) => { await request({ action: "unlock", passphrase }); },
      lock: async () => { await request({ action: "lock" }); },
      list: async () => await request({ action: "list" }) as ReturnType<VaultManager["list"]>,
      add: async (credential: Credential) => { await request({ action: "add", credential }); },
      edit: async (id: string, credential: Credential) => { await request({ action: "edit", id, credential }); },
      delete: async (id: string) => { await request({ action: "delete", id }); },
      get: async (id: string) => await request({ action: "get", id }) as Credential,
    };
    return { owner: false, close: async () => {}, vault };
  }
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
