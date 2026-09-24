import { describe, expect, it } from "bun:test";
import type { PageSession } from "../src/cdp/session";
import { pathsFor } from "../src/fuse/locate";
import type { SnapNode } from "../src/view/snap";

function fakeSession(nodes: Array<Record<string, unknown>>, stringTable: string[]): PageSession {
  return {
    client: {
      send: async (method: string) => {
        if (method === "DOMSnapshot.getSnapshot") return { domNodes: nodes, stringTable };
        throw new Error(`unexpected ${method}`);
      },
    },
  } as unknown as PageSession;
}

// structure: #document(0) > html(1) > head(2), body(3) > input#fname(4), select(5) > option(6, text)
// type 1 = element, nodeName references stringTable
const NODES = [
  { backendNodeId: 90, type: 9, nodeName: 0, parentIndex: -1 },   // #document
  { backendNodeId: 91, type: 1, nodeName: 1, parentIndex: 0 },    // HTML
  { backendNodeId: 92, type: 1, nodeName: 2, parentIndex: 1 },    // HEAD
  { backendNodeId: 92, type: 1, nodeName: 3, parentIndex: 1 },    // BODY
  { backendNodeId: 93, type: 1, nodeName: 4, parentIndex: 3 },    // INPUT
  { backendNodeId: 94, type: 1, nodeName: 5, parentIndex: 3 },    // SELECT
  { backendNodeId: 95, type: 1, nodeName: 6, parentIndex: 5 },    // OPTION
];
const STRINGS = ["#document", "HTML", "HEAD", "BODY", "INPUT", "SELECT", "OPTION"];

describe("pathsFor", () => {
  it("computes structural paths rooted at documentElement, counting element siblings", async () => {
    const byRef = new Map<string, SnapNode>([
      ["@e1", { ref: "@e1", axId: "a1", backendNodeId: 93, role: "textbox", name: "", depth: 0 }],
      ["@e2", { ref: "@e2", axId: "a2", backendNodeId: 94, role: "combobox", name: "", depth: 0 }],
      ["@e3", { ref: "@e3", axId: "a3", backendNodeId: 95, role: "option", name: "Bandung", depth: 0 }],
    ]);
    const paths = await pathsFor(fakeSession(NODES, STRINGS), byRef, new Set(["@e1", "@e2", "@e3"]));
    // body is html.children[1]; input is body.children[0]; select is body.children[1]; option is select.children[0]
    expect(paths["@e1"]).toEqual([1, 0]);
    expect(paths["@e2"]).toEqual([1, 1]);
    expect(paths["@e3"]).toEqual([1, 1, 0]);
  });

  it("throws stale_ref when a referenced ref is missing from the snapshot", async () => {
    const byRef = new Map<string, SnapNode>([
      ["@e1", { ref: "@e1", axId: "a1", backendNodeId: 999, role: "textbox", name: "", depth: 0 }],
    ]);
    const paths = pathsFor(fakeSession(NODES, STRINGS), byRef, new Set(["@e1"]));
    await expect(paths).rejects.toThrow(/no longer exists in DOM/);
  });

  it("throws stale_ref for a ref not in byRef (stale snapshot)", async () => {
    const byRef = new Map<string, SnapNode>();
    const paths = pathsFor(fakeSession(NODES, STRINGS), byRef, new Set(["@e1"]));
    await expect(paths).rejects.toThrow(/not in current snapshot/);
  });
});