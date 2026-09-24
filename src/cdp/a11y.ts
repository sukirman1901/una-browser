import type { PageSession } from "./session";
import type { SnapNode } from "../view/snap";
import { elementText } from "./dom";

const KEEP_ROLES = new Set([
  "button", "checkbox", "combobox", "heading", "image", "link", "listbox",
  "menuitem", "option", "progressbar", "radio", "searchbox", "slider",
  "status", "switch", "tab", "textbox",
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
    let name = (n.name?.value ?? "").trim();
    const interactive = role === "link" || role === "button" || role === "checkbox" || role === "combobox" ||
      role === "menuitem" || role === "radio" || role === "searchbox" || role === "slider" ||
      role === "switch" || role === "tab" || role === "textbox";
    if (role === "status" && name === "" && backendNodeId > 0 && !interactive) {
      const live = await elementText(session, backendNodeId);
      if (live.trim()) name = live.trim();
    }
    if (!interactive && !name && role !== "image") continue; // drop unnamed non-interactive noise
    const level = prop(n, "level");
    const checked = prop(n, "checked");
    out.push({
      ref: "",
      axId: n.nodeId ?? "",
      backendNodeId,
      role,
      name,
      depth: depth(n),
      level: typeof level === "number" ? level : undefined,
      checked: checked === "true" ? true : checked === "false" ? false : undefined,
      value: n.value?.value,
    });
  }

  if (out.some((n) => n.role === "option")) {
    const vals = await optionValues(session);
    for (const n of out) if (n.role === "option") n.value = vals.get(n.name) ?? n.value;
  }

  out.forEach((node, i) => { node.ref = `@e${i + 1}`; });
  return out;
}

// AX option nodes expose name (visible label) but not the DOM `value` attribute —
// `select @eN <value>` (dom.selectOption) matches on o.value, so source option
// values from the DOM, keyed by trimmed label text. One round trip, only when
// the tree contains option nodes.
async function optionValues(session: PageSession): Promise<Map<string, string>> {
  try {
    const res = await session.client.send("Runtime.evaluate", {
      expression: `Array.from(document.querySelectorAll("option")).map((o) => ({ t: o.textContent ?? "", v: o.value ?? "" }))`,
      returnByValue: true,
    });
    const pairs = ((res.result as { value?: unknown }).value ?? []) as Array<{ t: string; v: string }>;
    const map = new Map<string, string>();
    for (const p of pairs) if (p.t && p.v && !map.has(p.t.trim())) map.set(p.t.trim(), p.v);
    return map;
  } catch {
    return new Map();
  }
}