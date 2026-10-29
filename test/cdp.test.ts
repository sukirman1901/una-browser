import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChrome, closeChrome, type LaunchedChrome } from "../src/cdp/launcher";
import { cdpHttp } from "../src/cdp/http";
import { CdpClient } from "../src/cdp/client";
import { PageSession, type TabInfo } from "../src/cdp/session";

const root = mkdtempSync(join(tmpdir(), "una-cdp-"));
process.env.UNA_ROOT = root;

let launched: LaunchedChrome | undefined;

describe("PageSession.pickTarget", () => {
  const tab = (id: string, type: string): TabInfo => ({ id, type, url: "https://x/", title: "", webSocketDebuggerUrl: `ws://127.0.0.1/${id}` });
  it("prefers page targets and never falls back to devtools/service workers", () => {
    const tabs = [tab("d1", "devtools"), tab("s1", "service_worker"), tab("p1", "page"), tab("p2", "page")];
    expect(PageSession.pickTarget(tabs)!.id).toBe("p1");
    expect(PageSession.pickTarget(tabs.slice(0, 2))).toBeUndefined();
    expect(PageSession.pickTarget(tabs, "d1")!.id).toBe("d1");
  });
});

afterAll(async () => {
  if (launched) await closeChrome(launched);
  delete process.env.UNA_ROOT;
  rmSync(root, { recursive: true, force: true });
});

describe("cdp launch + client", () => {
  it("launches headless Chrome and reports a port", async () => {
    launched = await launchChrome();
    expect(launched.port).toBeGreaterThan(0);
    const v = await cdpHttp<{ Browser: string }>(launched.port, "/json/version");
    expect(v.Browser).toContain("Chrome");
  }, 30_000);

  it("connects to a page and evaluates JS", async () => {
    if (!launched) throw new Error("no launch");
    const tabs = await cdpHttp<Array<{ type: string; webSocketDebuggerUrl: string }>>(launched.port, "/json/list");
    const page = tabs.find((t) => t.type === "page");
    expect(page).toBeDefined();
    const client = await CdpClient.connect(page!.webSocketDebuggerUrl);
    const res = await client.send("Runtime.evaluate", { expression: "1 + 1", returnByValue: true });
    expect((res.result as { value: number }).value).toBe(2);
    client.close();
  }, 30_000);
});