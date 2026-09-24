import type { PageSession } from "../cdp/session";
import { UnaError } from "../errors";
import type { SnapNode } from "../view/snap";

type DomSnapNode = {
  backendNodeId?: number;
  nodeType?: number;
  type?: number;
  nodeName?: unknown;
  parentIndex?: number;
  childNodeIndexes?: number[];
};

const IS_ELEMENT = (n: DomSnapNode): boolean => (n.nodeType ?? n.type) === 1;

export async function pathsFor(
  session: PageSession,
  byRef: Map<string, SnapNode>,
  refs: Set<string>,
): Promise<Record<string, number[]>> {
  const refList = [...refs];
  for (const ref of refList) {
    if (!byRef.has(ref)) throw new UnaError("stale_ref", `ref ${ref} not in current snapshot`, "re-run: una snap");
  }

  const res = await session.client.send("DOMSnapshot.getSnapshot", { computedStyleWhitelist: [] });
  const nodes = (res.domNodes as DomSnapNode[] | undefined) ?? [];
  const stringTable = (res.stringTable as string[] | undefined) ?? [];

  const name = (i: number): string => {
    const n = nodes[i];
    const raw = n?.nodeName ?? "";
    return typeof raw === "number" ? (stringTable[raw] ?? "") : String(raw);
  };

  const parentOf = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((n, i) => {
    if (n.childNodeIndexes) {
      for (const c of n.childNodeIndexes) parentOf[c] = i;
      return;
    }
    const pIdx = n.parentIndex;
    if (typeof pIdx === "number" && pIdx >= 0) parentOf[i] = pIdx;
  });

  const childrenOf = (i: number): number[] => {
    const kids = nodes[i]?.childNodeIndexes;
    if (kids) return kids;
    const out: number[] = [];
    for (let j = 0; j < nodes.length; j++) if (nodes[j]?.parentIndex === i) out.push(j);
    return out;
  };

  const elemBefore = (target: number, parent: number): number | null => {
    let c = 0;
    for (const kid of childrenOf(parent)) {
      if (kid === target) return c;
      if (IS_ELEMENT(nodes[kid] ?? {})) c++;
    }
    return null;
  };

  const pathOf = (i: number): number[] => {
    const path: number[] = [];
    let cur = i;
    for (;;) {
      if (name(cur).toUpperCase() === "HTML") break;
      const p = parentOf[cur];
      if (p < 0) break;
      const ord = elemBefore(cur, p);
      if (ord === null) break;
      path.unshift(ord);
      cur = p;
    }
    return path;
  };

  const byBackend = new Map<number, number>();
  nodes.forEach((n, i) => { if (n.backendNodeId) byBackend.set(n.backendNodeId, i); });

  const out: Record<string, number[]> = {};
  for (const ref of refList) {
    const n = byRef.get(ref)!;
    const i = byBackend.get(n.backendNodeId);
    if (i === undefined) throw new UnaError("stale_ref", `element for ${ref} no longer exists in DOM`, "re-run: una snap");
    const p = pathOf(i);
    if (p.length === 0) throw new UnaError("stale_ref", `could not compute a path for ${ref}`, "re-run: una snap");
    out[ref] = p;
  }
  return out;
}