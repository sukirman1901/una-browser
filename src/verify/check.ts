import { UnaError } from "../errors";
import type { PageSession } from "../cdp/session";
import type { SnapNode } from "../view/snap";
import { elementValue } from "../cdp/dom";

export type CheckKind = "text" | "url" | "visible" | "hidden" | "count" | "input_value";

export interface CheckRule {
  kind: CheckKind;
  expect?: string;
  ref?: string;
}

export function parseExpect(input: string): CheckRule {
  const iv = input.match(/^input_value\s+(@?e\d+)(?:\s*=\s*"([^"]*)")?$/);
  if (iv) return { kind: "input_value", expect: iv[2] ?? undefined, ref: iv[1] };
  const eq = input.match(/^(\w+)="([^"]*)"$/);
  const space = input.match(/^(\w+)\s+(.+)$/);
  const bare = input.match(/^(\w+)$/);
  const parts = eq ?? space ?? bare;
  if (!parts) throw new UnaError("grammar", `bad check rule: '${input}'`, 'rules: text="...", url, visible @e1, hidden @e1, count "#row" 3, input_value @e1="..."');
  const kind = parts[1] as CheckKind;
  const value = parts[2] ? parts[2] : (space && parts[2] ? parts[2] : undefined);
  if (!["text", "url", "visible", "hidden", "count", "input_value"].includes(kind)) {
    throw new UnaError("grammar", `unknown check kind '${kind}'`, "known: text url visible hidden count input_value");
  }
  if (kind === "count") {
    const m2 = (value ?? "").match(/^(\S+)\s+(\d+)$/);
    if (!m2) throw new UnaError("grammar", 'count requires "<selector> <number>"', 'usage: una check count "#row" 3');
    const sel = m2[1].startsWith('"') && m2[1].endsWith('"') ? m2[1].slice(1, -1) : m2[1];
    return { kind, expect: sel, ref: m2[2] };
  }
  return { kind, expect: value ?? "", ref: value && value.startsWith("@") ? value : undefined };
}

export interface CheckResult {
  verdict: "PASS" | "FAIL";
  rule: string;
  actual?: unknown;
}

export async function runChecks(
  session: PageSession,
  byRef: Map<string, SnapNode>,
  raw: string,
): Promise<CheckResult> {
  const rule = parseExpect(raw);

  const evalPage = async (expr: string): Promise<unknown> => {
    const res = await session.client.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    return (res.result as { value?: unknown }).value;
  };

  const nodeOf = (ref: string): SnapNode => {
    const n = byRef.get(ref.startsWith("@") ? ref : `@${ref}`);
    if (!n) throw new UnaError("stale_ref", `ref ${ref} not in current snapshot`, "re-run: una snap");
    return n;
  };

  let pass = false;
  let actual: unknown;

  switch (rule.kind) {
    case "text": {
      const t = (await evalPage("document.body.innerText")) as string;
      actual = t;
      pass = rule.expect !== undefined && t.includes(rule.expect);
      break;
    }
    case "url": {
      const u = await evalPage("location.href");
      actual = u;
      pass = rule.expect === undefined || rule.expect === "" || u === rule.expect;
      break;
    }
    case "visible":
    case "hidden": {
      const n = nodeOf(rule.ref!);
      try {
        const { objectIdFor } = await import("../cdp/dom");
        const objectId = await objectIdFor(session, n.backendNodeId);
        const res = await session.client.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: "function(){ const r = this.getBoundingClientRect(); return r.width > 0 && r.height > 0; }",
          returnByValue: true,
        });
        const vis = (res.result as { value?: boolean }).value ?? false;
        actual = vis;
        pass = rule.kind === "visible" ? vis : !vis;
      } catch {
        actual = false;
        pass = rule.kind === "hidden";
      }
      break;
    }
    case "count": {
      const want = Number(rule.ref);
      const n = (await evalPage(`document.querySelectorAll(${JSON.stringify(rule.expect)}).length`)) as number;
      actual = n;
      pass = n === want;
      break;
    }
    case "input_value": {
      const n = nodeOf(rule.ref!);
      const v = await elementValue(session, n.backendNodeId);
      actual = v;
      pass = rule.expect === undefined || rule.expect === "" ? v !== "" : v === rule.expect;
      break;
    }
  }

  return { verdict: pass ? "PASS" : "FAIL", rule: raw, actual };
}