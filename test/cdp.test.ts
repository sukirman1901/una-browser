import { afterAll, describe, expect, it } from "bun:test";
import { launchChrome, closeChrome, type LaunchedChrome } from "../src/cdp/launcher";
import { cdpHttp } from "../src/cdp/http";
import { CdpClient } from "../src/cdp/client";

let launched: LaunchedChrome | undefined;

afterAll(() => {
  if (launched) closeChrome(launched);
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