import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultManager } from "../src/vault/manager";
import { startVaultUi } from "../src/vault/ui-server";
import { startDaemon, stopDaemon } from "../src/serve";

let root: string;
let vault: VaultManager;
let ui: ReturnType<typeof startVaultUi>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "una-ui-security-"));
  vault = new VaultManager(root);
  ui = startVaultUi(vault);
});
afterEach(async () => {
  await ui.close();
  rmSync(root, { recursive: true, force: true });
});

test("isolated loopback listener serves a nonsecret, noncacheable landing page", async () => {
  expect(ui.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  expect(ui.http.hostname).toBe("127.0.0.1");
  const response = await fetch(ui.url);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
  expect(await response.text()).not.toContain("synthetic-master");
});

test("rejects DNS rebinding, mismatched origins, invalid payloads and una HTTP routes", async () => {
  const url = ui.url;
  const form = new URLSearchParams({ csrf: "invalid", passphrase: "synthetic-master" });
  const post = (path: string, headers: Record<string, string>, body = form.toString()) => fetch(new URL(path, url), { method: "POST", headers, body });
  expect((await fetch(url, { headers: { Host: "attacker.test" } })).status).toBe(403);
  expect((await fetch(url, { headers: { Host: "localhost:9999" } })).status).toBe(403);
  expect((await post("/vault/unlock", { Origin: "https://attacker.test", "content-type": "application/x-www-form-urlencoded" })).status).toBe(403);
  expect((await post("/vault/unlock", { "content-type": "application/x-www-form-urlencoded" })).status).toBe(403);
  expect((await post("/vault/unlock", { Origin: new URL(url).origin, "content-type": "application/json" })).status).toBe(415);
  expect((await post("/vault/unlock", { Origin: new URL(url).origin, "content-type": "application/x-www-form-urlencoded" }, "x".repeat(20_000))).status).toBe(413);
  expect((await post("/vault/unlock", { Origin: new URL(url).origin, "content-type": "application/x-www-form-urlencoded" })).status).toBe(403);
  expect((await post("/vault/add", { Origin: new URL(url).origin, "content-type": "application/x-www-form-urlencoded" })).status).toBe(403);
  expect((await post("/", { Origin: new URL(url).origin, "content-type": "application/x-www-form-urlencoded" })).status).toBe(404);
  expect(vault.isUnlocked()).toBe(false);
});

test("pre-auth CSRF is tied to a cookie and rotated on successful unlock", async () => {
  vault.init("synthetic-master");
  vault.lock();
  const page = await fetch(ui.url);
  const html = await page.text();
  const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
  const token = html.match(/name="csrf" value="([^"]+)"/)?.[1];
  expect(token).toBeTruthy();
  const headers = { Origin: new URL(ui.url).origin, "content-type": "application/x-www-form-urlencoded", Cookie: cookie };
  const submit = (csrf: string, passphrase: string) => fetch(new URL("/vault/unlock", ui.url), { method: "POST", headers, body: new URLSearchParams({ csrf, passphrase }), redirect: "manual" });
  expect((await submit("bad", "synthetic-master")).status).toBe(403);
  expect(vault.isUnlocked()).toBe(false);
  const wrong = await submit(token!, "incorrect");
  expect(wrong.status).toBe(401);
  expect(await wrong.text()).not.toContain("incorrect");
  const good = await submit(token!, "synthetic-master");
  expect(good.status).toBe(303);
  expect(good.headers.get("set-cookie")).toContain("HttpOnly");
  expect(good.headers.get("set-cookie")).not.toContain(cookie);
  expect(good.headers.get("location")).toBe("/");
  expect(vault.isUnlocked()).toBe(true);
});

test("shutdown invalidates the listener and clears the session", async () => {
  await ui.close();
  expect(vault.isUnlocked()).toBe(false);
  expect(fetch(ui.url)).rejects.toThrow();
});

test("daemon exposes UI on a separate port, never on automation HTTP", async () => {
  const previous = process.env.UNA_ROOT;
  process.env.UNA_ROOT = root;
  const port = 31000 + Math.floor(Math.random() * 10000);
  try {
    const daemon = await startDaemon(port);
    try {
      expect(daemon.vaultUi.url).not.toContain(`:${port}/`);
      expect((await fetch(daemon.vaultUi.url)).status).toBe(200);
      const automation = await fetch(`http://127.0.0.1:${port}/vault/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(automation.ok).toBe(false);
    } finally { await stopDaemon(daemon); }
  } finally {
    if (previous === undefined) delete process.env.UNA_ROOT;
    else process.env.UNA_ROOT = previous;
  }
});
