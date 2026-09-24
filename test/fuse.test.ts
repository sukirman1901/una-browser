import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import type { PageSession } from "../src/cdp/session";
import { pathsFor } from "../src/fuse/locate";
import type { SnapNode } from "../src/view/snap";
import { startDaemon, stopDaemon, healthUrl, type Daemon } from "../src/serve";
import { startFixture } from "./server";

function fakeSession(nodes: Array<Record<string, unknown>>, stringTable?: string[]): PageSession {
  return {
    client: {
      send: async (method: string) => {
        if (method === "DOMSnapshot.getSnapshot") return { domNodes: nodes, ...(stringTable ? { stringTable } : {}) };
        throw new Error(`unexpected ${method}`);
      },
    },
  } as unknown as PageSession;
}

// structure: #document(0) > html(1) > head(2), body(3) > input#fname(4), select(5) > option(6)
// nodeType 1 = element; children recorded as childNodeIndexes (real Chrome DOMSnapshot shape)
const NODES = [
  { backendNodeId: 90, nodeType: 9, nodeName: "#document", childNodeIndexes: [1] },   // #document
  { backendNodeId: 91, nodeType: 1, nodeName: "HTML", childNodeIndexes: [2, 3] },     // HTML
  { backendNodeId: 92, nodeType: 1, nodeName: "HEAD", childNodeIndexes: [] },         // HEAD
  { backendNodeId: 96, nodeType: 1, nodeName: "BODY", childNodeIndexes: [4, 5] },     // BODY
  { backendNodeId: 93, nodeType: 1, nodeName: "INPUT", childNodeIndexes: [] },        // INPUT
  { backendNodeId: 94, nodeType: 1, nodeName: "SELECT", childNodeIndexes: [6] },      // SELECT
  { backendNodeId: 95, nodeType: 1, nodeName: "OPTION", childNodeIndexes: [] },       // OPTION
];

describe("pathsFor", () => {
  it("computes structural paths rooted at documentElement, counting element siblings", async () => {
    const byRef = new Map<string, SnapNode>([
      ["@e1", { ref: "@e1", axId: "a1", backendNodeId: 93, role: "textbox", name: "", depth: 0 }],
      ["@e2", { ref: "@e2", axId: "a2", backendNodeId: 94, role: "combobox", name: "", depth: 0 }],
      ["@e3", { ref: "@e3", axId: "a3", backendNodeId: 95, role: "option", name: "Bandung", depth: 0 }],
    ]);
    const paths = await pathsFor(fakeSession(NODES), byRef, new Set(["@e1", "@e2", "@e3"]));
    // body is html.children[1]; input is body.children[0]; select is body.children[1]; option is select.children[0]
    expect(paths["@e1"]).toEqual([1, 0]);
    expect(paths["@e2"]).toEqual([1, 1]);
    expect(paths["@e3"]).toEqual([1, 1, 0]);
  });

  it("throws stale_ref when a referenced ref is missing from the snapshot", async () => {
    const byRef = new Map<string, SnapNode>([
      ["@e1", { ref: "@e1", axId: "a1", backendNodeId: 999, role: "textbox", name: "", depth: 0 }],
    ]);
    const paths = pathsFor(fakeSession(NODES), byRef, new Set(["@e1"]));
    await expect(paths).rejects.toThrow(/no longer exists in DOM/);
  });

  it("throws stale_ref for a ref not in byRef (stale snapshot)", async () => {
    const byRef = new Map<string, SnapNode>();
    const paths = pathsFor(fakeSession(NODES), byRef, new Set(["@e1"]));
    await expect(paths).rejects.toThrow(/not in current snapshot/);
  });
});

import { parseFuseActions, buildExpression } from "../src/fuse/compiler";
import { UnaError } from "../src/errors";

describe("parseFuseActions", () => {
  const node = (ref: string, role: string): SnapNode => (({ ref, axId: ref, backendNodeId: 1, role, name: "", depth: 0 }) as SnapNode);

  it("accepts click/type/fill/select/check/get", () => {
    const a = parseFuseActions(["click @e1", "fill @e2 hi", "check text=\"ok\"", "get @e3"]);
    expect(a.map((x) => x.verb)).toEqual(["click", "fill", "check", "get"]);
  });

  it("rejects verbs outside the fuse scope", () => {
    expect(() => parseFuseActions(["open /"])).toThrow(UnaError);
    expect(() => parseFuseActions(["snap"])).toThrow(UnaError);
    expect(() => parseFuseActions(["wait 500"])).toThrow(UnaError);
    expect(() => parseFuseActions(["press Enter"])).toThrow(UnaError);
    expect(() => parseFuseActions(["fuse [\"click @e1\"]"])).toThrow(UnaError);
  });

  it("rejects check state rules", () => {
    expect(() => parseFuseActions(["check state loaded"])).toThrow(/state/);
  });

  it("parses check kinds into structured actions", () => {
    const a = parseFuseActions(["check text=\"ok\"", "check count \"#x\" 3", "check visible @e5", "check input_value @e2=\"a\""]);
    expect(a[0]).toMatchObject({ kind: "text", rule: 'text="ok"', expect: "ok" });
    expect(a[1]).toMatchObject({ kind: "count", selector: "#x", count: 3 });
    expect(a[2]).toMatchObject({ kind: "visible", ref: "@e5" });
    expect(a[3]).toMatchObject({ kind: "input_value", ref: "@e2", expect: "a" });
  });
});

describe("buildExpression", () => {
  const node = (ref: string, role: string): SnapNode => (({ ref, axId: ref, backendNodeId: 1, role, name: "", depth: 0 }) as SnapNode);

  it("embeds paths, roles and actions as JSON and returns an IIFE", () => {
    const byRef = new Map<string, SnapNode>([
      ["@e1", node("@e1", "button")],
      ["@e2", node("@e2", "textbox")],
    ]);
    const actions = parseFuseActions(["click @e1", "fill @e2 hi"]);
    const expr = buildExpression(actions, { "@e1": [1, 0], "@e2": [1, 1] }, byRef);
    expect(expr.startsWith("(() => {")).toBe(true);
    expect(expr).toContain('"@e1":[1,0]');
    expect(expr).toContain('"@e1":"button"');
    expect(expr).toContain(JSON.stringify({ verb: "click", ref: "@e1" }));
  });
});

describe("fuse through the daemon", () => {
  let daemon: Daemon;
  let server: Server<undefined>;
  const PORT = 18400 + Math.floor(Math.random() * 300);
  let base = "";

  async function cli(cmd: string): Promise<{ ok: boolean; result: unknown; error?: { code?: string; message?: string } }> {
    const r = await fetch(`${healthUrl(PORT)}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd }),
    });
    return (await r.json()) as { ok: boolean; result: unknown; error?: { code?: string; message?: string } };
  }

  function refFor(snap: string, needle: string): string {
    const line = snap.split("\n").find((l) => l.includes(needle));
    const m = line?.match(/@e\d+/);
    if (!m) throw new Error(`no ref for '${needle}' in:\n${snap}`);
    return m[0];
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

  it("runs a full chain in ONE Runtime.evaluate", async () => {
    await cli(`open ${base}/fuse`);
    const snap = (await cli("snap")).result as string;
    const nameRef = refFor(snap, "Fused name");
    const cityRef = refFor(snap, "combobox");
    const goRef = refFor(snap, "Go");

    // prove one-pass: count Runtime.evaluate sends during the fuse call
    let evaluates = 0;
    let domSnaps = 0;
    const c = daemon.controller.session.client;
    const orig = c.send.bind(c);
    c.send = (async (method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate") evaluates++;
      if (method === "DOMSnapshot.getSnapshot") domSnaps++;
      return orig(method, params);
    }) as typeof orig;

    let res: { ok: boolean; result: { done: number; ok: boolean; results: Array<{ verdict?: string }> } };
    try {
      const cmd = `fuse ${JSON.stringify([
        `fill ${nameRef} Budi`,
        `select ${cityRef} bdo`,
        `click ${goRef}`,
        `check text="OK Budi"`,
      ])}`;
      res = (await cli(cmd)) as typeof res;
    } finally {
      c.send = orig;
    }

    expect(res.ok).toBe(true);
    expect(res.result.ok).toBe(true);
    expect(res.result.done).toBe(4);
    const checks = res.result.results.filter((r) => r.verdict);
    expect(checks).toHaveLength(1);
    expect(checks[0].verdict).toBe("PASS");
    expect(evaluates).toBe(1);
    expect(domSnaps).toBe(1);
  });

  it("stops at the first failure when DOM changes mid-chain", async () => {
    await cli(`open ${base}/fuse`);
    const snap = (await cli("snap")).result as string;
    const nameRef = refFor(snap, "Fused name");
    const killRef = refFor(snap, "Remove input");
    const res = (await cli(`fuse ${JSON.stringify([`click ${killRef}`, `get ${nameRef}`])}`)) as {
      ok: boolean;
      result: { done: number; first_fail: { code: string; ref: string | null } };
    };
    expect(res.ok).toBe(true);
    expect(res.result.done).toBe(1);
    expect(res.result.first_fail.code).toBe("stale_ref");
  });

  it("check FAIL is recorded and the chain continues", async () => {
    await cli(`open ${base}/fuse`);
    const snap = (await cli("snap")).result as string;
    const nameRef = refFor(snap, "Fused name");
    const res = (await cli(`fuse ${JSON.stringify([
      `fill ${nameRef} Budi`,
      `check text="nope"`,
      `check text="Fuse"`,
    ])}`)) as { ok: boolean; result: { ok: boolean; done: number; results: Array<{ verdict?: string }> } };
    expect(res.ok).toBe(true);
    expect(res.result.ok).toBe(true);
    expect(res.result.done).toBe(3);
    expect(res.result.results.filter((r) => r.verdict).map((r) => r.verdict)).toEqual(["FAIL", "PASS"]);
  });

  it("stale snapshot ref raises stale_ref before evaluating", async () => {
    await cli(`open ${base}/fuse`);
    await cli("snap");
    const res = await cli(`fuse ${JSON.stringify(["click @e999"])}`);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("stale_ref");
  });

  it("select of a missing option reports not_found at the failing position", async () => {
    await cli(`open ${base}/fuse`);
    const snap = (await cli("snap")).result as string;
    const cityRef = refFor(snap, "combobox");
    const res = (await cli(`fuse ${JSON.stringify([`select ${cityRef} nope`])}`)) as {
      ok: boolean;
      result: { ok: boolean; done: number; first_fail: { code: string } };
    };
    expect(res.ok).toBe(true);
    expect(res.result.ok).toBe(false);
    expect(res.result.done).toBe(0);
    expect(res.result.first_fail.code).toBe("not_found");
  });

  it("forbidden verbs raise grammar errors without killing the daemon", async () => {
    const r1 = await cli(`fuse ${JSON.stringify(["open /"])}`);
    expect(r1.ok).toBe(false);
    expect(r1.error?.code).toBe("grammar");
    const r2 = await cli(`fuse ${JSON.stringify(["check state loaded"])}`);
    expect(r2.ok).toBe(false);
    expect(r2.error?.code).toBe("grammar");
    const h = await fetch(`${healthUrl(PORT)}/healthz`);
    expect(h.ok).toBe(true);
  });
});