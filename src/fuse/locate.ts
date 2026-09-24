import type { PageSession } from "../cdp/session";
import { UnaError } from "../errors";
import type { SnapNode } from "../view/snap";

type DomSnapNode = {
  backendNodeId?: number;
  type?: number;
  nodeName?: unknown;
  parentIndex?: number;
};

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
  const strings = (res.stringTable as string[] | undefined) ?? [];
  const name = (i: number): string => strings[(nodes[i]?.nodeName as number) ?? 0] ?? "";

  const elemBefore = (i: number, p: number): number => {
    let c = 0;
    for (let j = 0; j < i; j++) if (nodes[j]?.parentIndex === p && nodes[j]?.type === 1) c++;
    return c;
  };

  const pathOf = (i: number): number[] => {
    const path: number[] = [];
    let cur = i;
    for (;;) {
      if (name(cur) === "HTML") break;
      const parent = nodes[cur]?.parentIndex ?? -1;
      if (parent < 0) break;
      path.unshift(elemBefore(cur, parent));
      cur = parent;
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