import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { TabManager, firstSlot, type TabSlot } from "../src/tabs";
import type { PageSession } from "../src/cdp/session";
import { UnaError } from "../src/errors";
import { startDaemon, stopDaemon, healthUrl, type Daemon } from "../src/serve";
import { startFixture } from "./server";
import { settleParallel } from "../src/parallel/tabs";

function fakeSession(url: string, title: string): PageSession {
  return {
    targetId: `t-${url}`,
    current: async () => ({ url, title }),
    close: async () => {},
    closeTab: async () => {},
    client: { send: async () => ({}) },
  } as unknown as PageSession;
}

function fakeSlot(url: string, title: string): TabSlot {
  const s = fakeSession(url, title);
  return firstSlot(s);
}

describe("TabManager (mock slots)", () => {
  it("starts with the initial slot focused", () => {
    const t = new TabManager(0, fakeSlot("https://a.example", "A"));
    expect(t.focused().id).toBe("t-https://a.example");
    expect(t.count()).toBe(1);
  });

  it("switch by index moves focus", () => {
    const t = new TabManager(0, fakeSlot("https://a.example", "A"));
    const b = fakeSlot("https://b.example", "B");
    (t as unknown as { slots: TabSlot[]; focus: number }).slots.push(b);
    expect(t.focused().id).toBe("t-https://a.example");
    expect(t.count()).toBe(2);
    void b;
  });

  it("switch by url-prefix resolves a unique match", async () => {
    const t = new TabManager(0, fakeSlot("https://alpha.example", "Alpha"));
    const slotB = fakeSlot("https://beta.example", "Beta");
    (t as unknown as { slots: TabSlot[]; focus: number }).slots.push({ ...slotB, index: 1 });
    const s = await t.switch("beta");
    expect(s.index).toBe(1);
    expect(t.focused().id).toBe(slotB.id);
  });

  it("switch by ambiguous prefix errors with hint", async () => {
    const t = new TabManager(0, fakeSlot("https://alpha.example", "Alpha"));
    const slotB = fakeSlot("https://beta.example", "Beta");
    (t as unknown as { slots: TabSlot[]; focus: number }).slots.push({ ...slotB, index: 1 });
    await expect(t.switch("amp")).rejects.toThrow(UnaError);
    await expect(t.switch("amp")).rejects.toThrow(/matched 2 tabs/);
  });

  it("switch by no-match prefix errors", async () => {
    const t = new TabManager(0, fakeSlot("https://alpha.example", "Alpha"));
    await expect(t.switch("gamma")).rejects.toThrow(/matched 0 tabs/);
  });

  it("close reindexes remaining slots and fixes focus", async () => {
    const t = new TabManager(0, fakeSlot("https://a.example", "A"));
    const b = fakeSlot("https://b.example", "B");
    const c = fakeSlot("https://c.example", "C");
    (t as unknown as { slots: TabSlot[]; focus: number }).slots.push({ ...b, index: 1 }, { ...c, index: 2 });
    await t.switch(2);
    expect(t.focused().id).toBe(c.id);
    await t.close(0);
    expect(t.count()).toBe(2);
    const all = (t as unknown as { slots: TabSlot[] }).slots;
    expect(all.map((s) => s.index)).toEqual([0, 1]);
    expect(t.focused().id).toBe(c.id); // index 2 -> 1
    await t.switch(0);
    expect(t.focused().id).toBe(b.id);
  });

  it("close of the focused tab falls back to the previous slot", async () => {
    const t = new TabManager(0, fakeSlot("https://a.example", "A"));
    const b = fakeSlot("https://b.example", "B");
    (t as unknown as { slots: TabSlot[]; focus: number }).slots.push({ ...b, index: 1 });
    await t.switch(1);
    await t.close(1);
    expect(t.focused().id).toBe("t-https://a.example");
  });

  it("closing the last tab raises not_found", async () => {
    const t = new TabManager(0, fakeSlot("https://a.example", "A"));
    const p = t.close(0);
    await expect(p).rejects.toThrow(UnaError);
    await expect(p).rejects.toThrow(/no tabs left/);
  });
});

describe("settleParallel", () => {
  it("summarizes ok/failed counts", () => {
    const s = settleParallel([
      { status: "ok", url: "https://a.example", title: "A" },
      { status: "error", url: "https://b.example", message: "boom" },
      { status: "ok", url: "https://c.example", title: "C" },
    ]);
    expect(s.ok).toBe(false);
    expect(s.parallel).toBe(true);
    expect(s.okCount).toBe(2);
    expect(s.failed).toBe(1);
  });
});

describe("multi-tab + parallel through the daemon", () => {
  let daemon: Daemon;
  let server: Server<undefined>;
  const PORT = 18700 + Math.floor(Math.random() * 200);
  let base = "";

  async function cli(cmd: string): Promise<{ ok: boolean; result: unknown; error?: { code?: string; message?: string } }> {
    const r = await fetch(`${healthUrl(PORT)}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd }),
    });
    return (await r.json()) as { ok: boolean; result: unknown; error?: { code?: string; message?: string } };
  }

  async function post(body: unknown): Promise<{ ok: boolean; result: unknown; error?: { code?: string; message?: string } }> {
    const r = await fetch(`${healthUrl(PORT)}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as { ok: boolean; result: unknown; error?: { code?: string; message?: string } };
  }

  beforeAll(async () => {
    server = await startFixture(0);
    base = `http://127.0.0.1:${server.port}`;
    daemon = await startDaemon(PORT);
  });

  afterAll(async () => {
    await stopDaemon(daemon);
    server?.stop();
  });

  it("tab opens a second tab focused, tabs lists both with original url intact", async () => {
    await cli(`open ${base}/`);
    const t = await cli(`tab ${base}/page2`);
    expect(t.ok).toBe(true);
    expect((t.result as { title: string }).title).toBe("PageTwo");
    expect((t.result as { index: number }).index).toBe(1);

    const tabs = (await cli("tabs")).result as { tabs: { index: number; url: string; title: string; active: boolean }[] };
    expect(tabs.tabs).toHaveLength(2);
    expect(tabs.tabs[0].url).toBe(`${base}/`);
    expect(tabs.tabs[1].title).toBe("PageTwo");
    expect(tabs.tabs[1].active).toBe(true);
  });

  it("switch by index repoints the focused tab", async () => {
    const s = await cli("switch 0");
    expect(s.ok).toBe(true);
    expect((s.result as { index: number }).index).toBe(0);
    const cur = (await cli(`eval document.title`)).result as { value: string };
    expect(cur.value).toBe("UnaFixture");
  });

  it("switch by url-prefix repoints the focused tab", async () => {
    await cli("switch page2");
    const cur = (await cli(`eval document.title`)).result as { value: string };
    expect(cur.value).toBe("PageTwo");
  });

  it("refs and state are relative to the focused tab", async () => {
    await cli("switch 0");
    const snap = (await cli("snap")).result as string;
    expect(snap).toContain("Una Fixture");
    await cli("switch 1");
    const snap2 = (await cli("snap")).result as string;
    expect(snap2).toContain("Page Two");
  });

  it("close by index removes the tab and reindexes", async () => {
    const c = await cli("close 1");
    expect(c.ok).toBe(true);
    expect((c.result as { tabs: number }).tabs).toBe(1);
    const tabs = (await cli("tabs")).result as { tabs: { index: number }[] };
    expect(tabs.tabs).toHaveLength(1);
  });

  it("parallel harvests multiple urls concurrently and restores focus", async () => {
    await cli(`open ${base}/`);
    await cli(`tab ${base}/page3`);
    await cli("switch 0");

    const res = await post({
      parallel: {
        urls: [`${base}/`, `${base}/page2`],
        js: "() => document.querySelector('h1')?.textContent ?? document.title",
      },
    });
    expect(res.ok).toBe(true);
    const summary = res.result as { ok: boolean; parallel: boolean; okCount: number; failed: number; results: { status: string; url: string; result?: unknown; message?: string }[] };
    expect(summary.parallel).toBe(true);
    expect(summary.okCount).toBe(2);
    expect(summary.failed).toBe(0);
    const titles = summary.results.map((r) => r.result).sort();
    expect(titles).toContain("Una Fixture");
    expect(titles).toContain("Page Two");

    // manual tab list untouched, focus restored where it was
    const tabs = (await cli("tabs")).result as { tabs: { index: number; active: boolean; url: string }[] };
    expect(tabs.tabs).toHaveLength(2);
    expect(tabs.tabs[0].active).toBe(true);
    expect(tabs.tabs[0].url).toBe(`${base}/`);
    const title = (await cli(`eval document.title`)).result as { value: string };
    expect(title.value).toBe("UnaFixture");
  });

  it("parallel reports per-job errors without killing the daemon", async () => {
    const res = await post({
      parallel: [
        { url: `${base}/` },
        { url: `${base}/page3`, js: "() => { throw new Error('kaput'); }" },
      ],
    });
    expect(res.ok).toBe(true);
    const summary = res.result as { ok: boolean; okCount: number; failed: number };
    expect(summary.ok).toBe(false);
    expect(summary.okCount).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it("parallel caps at 8 jobs", async () => {
    const res = await post({
      parallel: { urls: Array.from({ length: 9 }, (_, i) => `${base}/page${i}`) },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("invalid");
  });
});