import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { VaultManager } from "../src/vault/manager";
import { startVaultSocket, sendVaultRequest, vaultSocketPath } from "../src/vault/ipc";
import { parseArgs } from "../src/args";

const dirs: string[] = [];
function temp(): string { const d = mkdtempSync(join(tmpdir(), "una-vault-ipc-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test("private socket manages vault without returning secrets", async () => {
  const root = temp();
  const manager = new VaultManager(root);
  const server = await startVaultSocket(manager, root, 18672);
  try {
    expect(statSync(join(root, "vault")).mode & 0o777).toBe(0o700);
    expect(statSync(vaultSocketPath(root, 18672)).mode & 0o777).toBe(0o600);
    expect(await sendVaultRequest(root, 18672, { action: "init", passphrase: "synthetic-master" })).toEqual({ ok: true });
    expect(await sendVaultRequest(root, 18672, { action: "add", credential: { website: "https://example.org", username: "u@example.org", password: "synthetic-password", notes: "secret note" } })).toEqual({ ok: true });
    const listed = await sendVaultRequest(root, 18672, { action: "list" });
    expect(JSON.stringify(listed)).not.toContain("synthetic-password");
    expect(JSON.stringify(listed)).not.toContain("secret note");
    expect(await sendVaultRequest(root, 18672, { action: "lock" })).toEqual({ ok: true });
    expect(manager.isUnlocked()).toBe(false);
    expect((await sendVaultRequest(root, 18672, { action: "unlock", passphrase: "wrong" })).ok).toBe(false);
    expect(manager.isUnlocked()).toBe(false);
    expect((await sendVaultRequest(root, 18672, { action: "unlock", passphrase: "synthetic-master" })).ok).toBe(true);
    const id = manager.list()[0]!.id;
    expect((await sendVaultRequest(root, 18672, { action: "edit", id, credential: { website: "https://example.org", username: "u@example.org", password: "rotated-synthetic", notes: "private" } })).ok).toBe(true);
    expect(manager.get(id).password).toBe("rotated-synthetic");
    expect((await sendVaultRequest(root, 18672, { action: "delete", id })).ok).toBe(true);
    expect(manager.list()).toEqual([]);
  } finally { await server.close(); }
});

test("restarting manager loses unlocked key", () => {
  const root = temp();
  new VaultManager(root).init("synthetic-master");
  expect(new VaultManager(root).isUnlocked()).toBe(false);
});

test("management actions are not part of daemon HTTP command grammar", () => {
  for (const verb of ["init", "add", "unlock", "lock", "edit", "delete"]) {
    expect(() => parseArgs(["vault", verb, "secret-argument"])).toThrow();
  }
});

test("CLI rejects secret positional arguments before prompting", async () => {
  const { vaultCliRequest } = await import("../src/vault/prompt");
  expect(() => vaultCliRequest(["unlock", "password-on-command-line"])).toThrow();
  expect(() => vaultCliRequest(["add", "https://example.org", "username", "password"])).toThrow();
});

test("CLI never echoes a credential supplied as an argument", () => {
  const result = spawnSync("bun", ["bin/una.ts", "vault", "unlock", "synthetic-secret-argument"], { cwd: join(import.meta.dir, ".."), encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).not.toContain("synthetic-secret-argument");
  expect(result.stdout + result.stderr).toContain("no credential arguments");
});
