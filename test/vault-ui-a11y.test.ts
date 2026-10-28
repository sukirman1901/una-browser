import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultManager } from "../src/vault/manager";
import { startVaultUi } from "../src/vault/ui-server";

let root: string;
let ui: ReturnType<typeof startVaultUi>;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "una-ui-a11y-")); ui = startVaultUi(new VaultManager(root)); });
afterEach(async () => { await ui.close(); rmSync(root, { recursive: true, force: true }); });

test("setup screen has visible labels, status and responsive local assets", async () => {
  const html = await (await fetch(ui.url)).text();
  expect(html).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('<label for="passphrase">');
  expect(html).toContain('<label for="confirm">');
  expect(html).toContain('type="password"');
  expect(html).toContain('data-password-toggle');
  expect(html).toContain('href="/vault.css"');
  expect(html).toContain('src="/vault.js"');
  expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
  const css = await (await fetch(new URL("/vault.css", ui.url))).text();
  expect(css).toContain("prefers-color-scheme: dark");
  expect(css).toContain(":focus-visible");
  expect(css).toContain("max-width: 100%");
  expect(css).toContain("prefers-reduced-motion: reduce");
  const js = await (await fetch(new URL("/vault.js", ui.url))).text();
  expect(js).toContain("aria-pressed");
  expect(js).toContain("aria-busy");
});

test("error messages are announced without echoing the secret", async () => {
  const page = await fetch(ui.url);
  const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)![1]!;
  const r = await fetch(new URL("/vault/init", ui.url), {
    method: "POST", redirect: "manual",
    headers: { Cookie: cookie, Origin: new URL(ui.url).origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf, passphrase: "synthetic-master", confirm: "mismatch" }),
  });
  const html = await r.text();
  expect(html).toContain('role="alert"');
  expect(html).not.toContain("synthetic-master");
});

test("neutral centered form keeps one visible heading and an accessible status", async () => {
  const html = await (await fetch(ui.url)).text();
  expect(html).toContain('<div aria-live="polite" class="status">Vault locked</div>');
  const css = await (await fetch(new URL("/vault.css", ui.url))).text();
  expect(css).toContain("--accent: #18181b");
  expect(css).toContain("--bg: #ffffff");
  expect(css).toContain("--bg: #09090b");
  expect(css).toContain("align-content: center");
  expect(css).toContain(".status {\n  position: absolute;");
});
