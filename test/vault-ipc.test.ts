import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { VaultManager } from "../src/vault/manager";
import { startVaultSocket, sendVaultRequest, vaultSocketPath, connectSharedVault } from "../src/vault/ipc";
import { vaultCliRequest } from "../src/vault/prompt";
import { parseArgs } from "../src/args";

const dirs: string[] = [];
function temp(): string { const d = mkdtempSync(join(tmpdir(), "una-vault-ipc-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test("one unlocked vault serves another profile without another passphrase; lock revokes access", async () => {
  const root = temp();
  const owner = new VaultManager(root);
  const first = await connectSharedVault(owner, root);
  try {
    owner.init("synthetic-master");
    const id = owner.add({ website: "https://example.org", username: "synthetic", password: "secret-fixture", notes: "" });
    const second = await connectSharedVault(new VaultManager(root), root);
    expect(await second.vault.isUnlocked()).toBe(true);
    expect(await second.vault.list()).toEqual(owner.list());
    expect(await second.vault.get(id)).toEqual(owner.get(id));

    // The borrower's CLI socket must reflect the owner vault, not the locked local copy.
    const borrowerPort = 18674;
    const borrower = await startVaultSocket(second.vault, root, borrowerPort);
    try {
      expect((await sendVaultRequest(root, borrowerPort, { action: "status" })).result).toEqual({ unlocked: true });
      expect((await sendVaultRequest(root, borrowerPort, { action: "list" })).result).toEqual(owner.list());
      expect((await sendVaultRequest(root, borrowerPort, { action: "add", credential: { website: "https://example.net", username: "borrower", password: "borrow-secret", notes: "" } })).ok).toBe(true);
      expect(owner.list().some((x) => x.username === "borrower")).toBe(true);
      expect((await sendVaultRequest(root, borrowerPort, { action: "get", id })).ok).toBe(false);
    } finally {
      await borrower.close();
      const borrowerUsername = owner.list().find((x) => x.username === "borrower");
      if (borrowerUsername) owner.delete(borrowerUsername.id);
    }

    // Locking from the borrower closes the shared session for everyone.
    await second.vault.lock();
    expect(await second.vault.isUnlocked()).toBe(false);
    await expect(second.vault.get(id)).rejects.toThrow();
  } finally { await first.close(); }
});

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

test("CLI refuses master passphrase entry without a terminal", async () => {
  if (process.stdin.isTTY) return;
  await expect(vaultCliRequest(["unlock"])).rejects.toThrow("interactive terminal");
});
