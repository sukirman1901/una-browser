import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVault, openVault, type Credential } from "../src/vault/store";

const roots: string[] = [];
function root(): string {
  const path = mkdtempSync(join(tmpdir(), "una-vault-test-"));
  roots.push(path);
  return path;
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

const account: Credential = {
  website: "https://www.instagram.com/accounts/login/",
  username: "test@example.org",
  password: "not-a-real-password!",
  notes: "sample private note",
};

describe("encrypted vault store", () => {
  test("round trips credentials without persisting secrets in plaintext", () => {
    const dir = root();
    const vault = createVault(dir, "master-passphrase-long");
    const id = vault.add(account);
    expect(openVault(dir, "master-passphrase-long").get(id)).toEqual({ ...account, website: "https://www.instagram.com/" });
    const raw = readFileSync(join(dir, "vault", "data.json"), "utf8");
    for (const secret of [account.username, account.password, account.notes]) expect(raw).not.toContain(secret);
    expect(statSync(join(dir, "vault")).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "vault", "data.json")).mode & 0o777).toBe(0o600);
  });

  test("rejects incorrect master passphrase", () => {
    const dir = root();
    createVault(dir, "correct-secret");
    expect(() => openVault(dir, "wrong-secret")).toThrow();
  });

  test("rejects tampered encrypted data", () => {
    const dir = root();
    createVault(dir, "correct-secret").add(account);
    const path = join(dir, "vault", "data.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    data.entries[0].ciphertext = "AAAAAAAAAAAAAAAAAAAAAA==";
    writeFileSync(path, JSON.stringify(data));
    expect(() => openVault(dir, "correct-secret")).toThrow();
  });

  test("rejects duplicate site and username and unsupported version", () => {
    const dir = root();
    const vault = createVault(dir, "correct-secret");
    vault.add(account);
    expect(() => vault.add(account)).toThrow();
    const path = join(dir, "vault", "data.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    data.version = 999;
    writeFileSync(path, JSON.stringify(data));
    expect(() => openVault(dir, "correct-secret")).toThrow();
  });

  test("never overwrites a vault on init", () => {
    const dir = root();
    createVault(dir, "correct-secret");
    expect(() => createVault(dir, "new-secret")).toThrow();
    expect(openVault(dir, "correct-secret").list()).toEqual([]);
  });

  test("failed update does not modify existing ciphertext", () => {
    const dir = root();
    const vault = createVault(dir, "correct-secret");
    const file = join(dir, "vault", "data.json");
    const original = readFileSync(file, "utf8");
    chmodSync(file, 0o644);
    expect(() => vault.add(account)).toThrow("unsafe vault file");
    expect(readFileSync(file, "utf8")).toBe(original);
    chmodSync(file, 0o600);
  });

  test("updates and deletes an existing credential", () => {
    const dir = root();
    const vault = createVault(dir, "correct-secret");
    const id = vault.add(account);
    vault.update(id, { ...account, password: "rotated-synthetic-password" });
    expect(openVault(dir, "correct-secret").get(id).password).toBe("rotated-synthetic-password");
    vault.delete(id);
    expect(openVault(dir, "correct-secret").list()).toEqual([]);
  });
});
