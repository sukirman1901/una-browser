export interface SnapNode {
  ref: string;
  axId: string;
  backendNodeId: number;
  role: string;
  name: string;
  depth: number;
  level?: number;
  checked?: boolean;
  value?: string;
}

export const INTERACTIVE_ROLES = new Set([
  "button", "checkbox", "combobox", "link", "listbox", "menuitem", "option",
  "radio", "searchbox", "slider", "switch", "tab", "textbox",
]);

export interface SerializeOpts {
  interactiveOnly?: boolean;
  urls?: boolean;
  compact?: boolean;
  depth?: number;
}

function roleStr(node: SnapNode): string {
  return node.role === "textbox" ? "input" : node.role;
}

function attrs(node: SnapNode): string {
  const parts: string[] = [];
  if (typeof node.level === "number") parts.push(`level=${node.level}`);
  if (node.checked === true) parts.push("checked");
  if (node.checked === false) parts.push("unchecked");
  if (node.role === "option" && node.value !== undefined && node.value !== "") parts.push(`value="${node.value}"`);
  return parts.length ? ` [${parts.join(", ")}]` : "";
}

function collapse(name: string, urls: boolean): string {
  if (!urls) return name.length > 80 ? `${name.slice(0, 79)}…` : name;
  return name.length > 120 ? `${name.slice(0, 119)}…` : name;
}

export function serializeSnap(nodes: SnapNode[], opts: SerializeOpts = {}): string {
  const {
    interactiveOnly = false,
    urls = false,
    compact = false,
    depth = 32,
  } = opts;

  const lines: string[] = [];
  for (const n of nodes) {
    if (n.depth > depth) continue;
    if (interactiveOnly && !INTERACTIVE_ROLES.has(n.role)) continue;
    const name = collapse(n.name, urls);
    if (compact && !INTERACTIVE_ROLES.has(n.role) && name === "") continue;
    const indent = "  ".repeat(n.depth);
    lines.push(`${indent}${n.ref} ${roleStr(n)}${attrs(n)} "${name}"`);
  }
  return lines.join("\n");
}