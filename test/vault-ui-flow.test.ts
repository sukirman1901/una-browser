import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultManager } from "../src/vault/manager";
import { startVaultUi } from "../src/vault/ui-server";

let root: string;
let vault: VaultManager;
let ui: ReturnType<typeof startVaultUi>;
let cookie = "";
let csrf = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "una-ui-flow-"));
  vault = new VaultManager(root);
  ui = startVaultUi(vault);
});
afterEach(async () => { await ui.close(); rmSync(root, { recursive: true, force: true }); });

async function page(path = "/"): Promise<string> {
  const r = await fetch(new URL(path, ui.url), { headers: cookie ? { Cookie: cookie } : {} });
  if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  const html = await r.text();
  csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "";
  return html;
}

async function submit(path: string, fields: Record<string, string>, method = "POST") {
  const r = await fetch(new URL(path, ui.url), {
    method, redirect: "manual",
    headers: { Origin: new URL(ui.url).origin, "content-type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams({ csrf, ...fields }),
  });
  if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  return r;
}

test("setup, add, edit, confirm delete and lock without rendering any secret", async () => {
  let html = await page();
  expect(html).toContain("Create vault");
  const setup = await submit("/vault/init", { passphrase: "synthetic-master", confirm: "synthetic-master" });
  expect(setup.status).toBe(303);
  expect(setup.headers.get("location")).toBe("/");
  expect(await setup.text()).not.toContain("synthetic-master");
  html = await page();
  expect(html).toContain("Add login");
  const add = await submit("/vault/add", { website: "https://example.org", username: "user@example.org", password: "synthetic-password", notes: "private-note" });
  expect(add.status).toBe(303);
  expect(JSON.stringify([...add.headers])).not.toContain("synthetic-password");
  html = await page();
  expect(html).toContain("user@example.org");
  for (const secret of ["synthetic-master", "synthetic-password", "private-note"]) expect(html).not.toContain(secret);
  const id = vault.list()[0]!.id;
  html = await page(`/vault/edit/${id}`);
  expect(html).toContain("Edit login");
  expect(html).toMatch(/<form method="post" action="\/vault\/edit\/[0-9a-f-]{36}">[\s\S]*?<button type="submit">Save changes<\/button><a class="secondary-action" href="\/">Cancel<\/a><\/form>/);
  expect(html).not.toContain("synthetic-password");
  expect(html).not.toContain("private-note");
  const edited = await submit(`/vault/edit/${id}`, { website: "https://example.org", username: "new@example.org", password: "rotated-synthetic", notes: "new-private" });
  expect(edited.status).toBe(303);
  expect(vault.get(id).password).toBe("rotated-synthetic");
  html = await page(`/vault/delete/${id}`);
  expect(html).toContain("Delete login?");
  expect(html).toMatch(/<form action="\/vault\/delete\/[0-9a-f-]{36}" method="post">[\s\S]*?<button type="submit">Delete login<\/button><a class="secondary-action" href="\/">Cancel<\/a><\/form>/);
  expect((await submit(`/vault/delete/${id}`, { confirm: "no" })).status).toBe(400);
  expect(vault.list()).toHaveLength(1);
  expect((await submit(`/vault/delete/${id}`, { confirm: "yes" })).status).toBe(303);
  expect(vault.list()).toHaveLength(0);
  await page();
  expect((await submit("/vault/lock", {})).status).toBe(303);
  expect(vault.isUnlocked()).toBe(false);
  expect(await page()).toContain("Unlock vault");
});

test("invalid setup, wrong passphrase, duplicate and invalid site leave data intact", async () => {
  await page();
  expect((await submit("/vault/init", { passphrase: "synthetic-master", confirm: "mismatch" })).status).toBe(400);
  expect(vault.isUnlocked()).toBe(false);
  expect((await submit("/vault/init", { passphrase: "synthetic-master", confirm: "synthetic-master" })).status).toBe(303);
  await page();
  const valid = { website: "https://example.org", username: "u@example.org", password: "synthetic-password", notes: "private-note" };
  expect((await submit("/vault/add", valid)).status).toBe(303);
  await page();
  expect((await submit("/vault/add", valid)).status).toBe(409);
  expect((await submit("/vault/add", { ...valid, website: "http://example.org" })).status).toBe(400);
  expect(vault.list()).toHaveLength(1);
  expect((await page()).includes("synthetic-password")).toBe(false);
  expect((await submit("/vault/lock", {})).status).toBe(303);
  await page();
  const wrong = await submit("/vault/unlock", { passphrase: "not-the-master" });
  expect(wrong.status).toBe(401);
  expect(await wrong.text()).not.toContain("not-the-master");
  expect((await submit("/vault/unlock", { passphrase: "synthetic-master" })).status).toBe(303);
  expect(vault.list()).toHaveLength(1);
});

test("incorrect master passphrase keeps an empty unlock form with inline feedback and permits retry", async () => {
  await page();
  expect((await submit("/vault/init", { passphrase: "synthetic-master", confirm: "synthetic-master" })).status).toBe(303);
  await page();
  expect((await submit("/vault/lock", {})).status).toBe(303);
  const initial = await page();
  expect(initial).not.toContain("unlock-error");
  const wrong = await submit("/vault/unlock", { passphrase: "wrong-synthetic-master" });
  expect(wrong.status).toBe(401);
  const html = await wrong.text();
  expect(html).toContain('<form method="post" action="/vault/unlock">');
  expect(html).toMatch(/<input id="passphrase"[^>]*aria-describedby="unlock-error"[^>]*autofocus[^>]*>/);
  expect(html).toMatch(/<button type="submit">Unlock vault<\/button><p id="unlock-error" class="field-error" role="alert">Master passphrase is incorrect\. Try again\.<\/p>/);
  expect(html).not.toContain("wrong-synthetic-master");
  expect(html).not.toContain("synthetic-master");
  expect(vault.isUnlocked()).toBe(false);
  expect((await submit("/vault/unlock", { passphrase: "synthetic-master" })).status).toBe(303);
});

test("a stale authenticated browser cannot modify data after CLI lock/reunlock", async () => {
  await page();
  await submit("/vault/init", { passphrase: "synthetic-master", confirm: "synthetic-master" });
  await page();
  vault.lock();
  vault.unlock("synthetic-master");
  expect((await submit("/vault/add", { website: "https://example.org", username: "u", password: "synthetic-password", notes: "" })).status).toBe(403);
  expect(vault.list()).toHaveLength(0);
});

test("rejects ambiguous duplicate form fields rather than saving a substituted credential", async () => {
  await page();
  await submit("/vault/init", { passphrase: "synthetic-master", confirm: "synthetic-master" });
  await page();
  const r = await fetch(new URL("/vault/add", ui.url), {
    method: "POST", redirect: "manual",
    headers: { Origin: new URL(ui.url).origin, Cookie: cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams([
      ["csrf", csrf], ["website", "https://example.org"], ["username", "u"], ["password", "synthetic-password"], ["password", "substitute"], ["notes", ""],
    ]),
  });
  expect(r.status).toBe(400);
  expect(vault.list()).toHaveLength(0);
});

test("renders account identifiers HTML-escaped", async () => {
  await page();
  await submit("/vault/init", { passphrase: "synthetic-master", confirm: "synthetic-master" });
  await page();
  expect((await submit("/vault/add", { website: "https://example.org", username: '<img src=x onerror=alert(1)>', password: "synthetic-password", notes: "" })).status).toBe(303);
  const html = await page();
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(html).not.toContain("<img src=x");
});
