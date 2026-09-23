import type { PageSession } from "./session";
import type { SnapNode } from "../view/snap";

const KEEP_ROLES = new Set([
  "button", "checkbox", "combobox", "heading", "img", "link", "listbox",
  "menuitem", "option", "progressbar", "radio", "searchbox", "slider",
  "switch", "tab", "textbox",
]);

type RawAxNode = {
  nodeId?: string;
  ignored?: boolean;
  parentId?: string;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  backendDOMNodeId?: number;
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
};

function prop(raw: RawAxNode, name: string): unknown {
  const p = raw.properties?.find((x) => x.name === name);
  return p?.value?.value;
}

export async function collectAxTree(session: PageSession): Promise<SnapNode[]> {
  const res = await session.client.send("Accessibility.getFullAXTree");
  const raw = (res.nodes ?? []) as RawAxNode[];

  const parentOf = new Map<string, string>();
  for (const n of raw) {
    if (n.nodeId && n.parentId) parentOf.set(n.nodeId, n.parentId);
  }
  const depthOf = (id: string): number => {
    let depth = 0;
    let cur: string | undefined = id;
    while (cur && parentOf.has(cur) && depth < 64) {
      cur = parentOf.get(cur);
      depth++;
    }
    return depth;
  };

  const out: SnapNode[] = [];
  const depth = (n: RawAxNode): number => (n.nodeId ? depthOf(n.nodeId) : 0);

  for (const n of raw) {
    const role = n.role?.value ?? "";
    if (!KEEP_ROLES.has(role)) continue;
    if (n.ignored === true) continue;
    const backendNodeId = n.backendDOMNodeId ?? 0;
    if (backendNodeId <= 0) continue; // AX-only nodes (text/static) aren't actionable
    const name = (n.name?.value ?? "").trim();
    const interactive = role === "link" || role === "button" || role === "checkbox" || role === "combobox" ||
      role === "menuitem" || role === "radio" || role === "searchbox" || role === "slider" ||
      role === "switch" || role === "tab" || role === "textbox";
    if (!interactive && !name && role !== "img") continue; // drop unnamed non-interactive noise
    const level = prop(n, "level");
    out.push({
      ref: "",
      axId: n.nodeId ?? "",
      backendNodeId,
      role,
      name,
      depth: depth(n),
      level: typeof level === "number" ? level : undefined,
      checked: undefined,
      value: n.value?.value,
    });
  }

  out.forEach((node, i) => { node.ref = `@e${i + 1}`; });
  return out;
}