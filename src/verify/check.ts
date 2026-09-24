import { UnaError } from "../errors";
import type { PageSession } from "../cdp/session";
import type { SnapNode } from "../view/snap";
import { elementValue, objectIdFor } from "../cdp/dom";
import { detectState } from "../state/detect";

const REF_RE = /^@?e\d+$/;
const REF_KINDS = new Set(["visible", "hidden", "input_value"]);

export type CheckKind = "text" | "url" | "visible" | "hidden" | "count" | "input_value" | "state";

export interface CheckRule {
  kind: CheckKind;
  expect?: string;
  ref?: string;
}

export function parseExpect(input: string): CheckRule {
  const iv = input.match(/^input_value\s+(@?e\d+)(?:\s*=\s*"([^"]*)")?$/);
  if (iv) return { kind: "input_value", expect: iv[2] ?? undefined, ref: iv[1] };
  const eq = input.match(/^(\w+)="([^"]*)"$/);
  const eqBare = input.match(/^(\w+)=([^\s"']+)$/);
  const space = input.match(/^(\w+)\s+(.+)$/);
  const bare = input.match(/^(\w+)$/);
  const parts = eq ?? eqBare ?? space ?? bare;
  if (!parts) throw new UnaError("grammar", `bad check rule: '${input}'`, 'rules: text="...", url, visible @e1, hidden @e1, count "#row" 3, input_value @e1="..."');
  const kind = parts[1] as CheckKind;
  const value = parts[2] ?? undefined;
  if (!["text", "url", "visible", "hidden", "count", "input_value", "state"].includes(kind)) {
    throw new UnaError("grammar", `unknown check kind '${kind}'`, "known: text url visible hidden count input_value state");
  }
  if (kind === "state") {
    const want = value ?? "";
    if (want && !["loaded", "challenge", "blocked"].includes(want)) {
      throw new UnaError("grammar", `bad state '${want}'`, 'states: loaded | challenge | blocked');
    }
    return { kind: "state", expect: want || undefined, ref: undefined };
  }
  if (kind === "count") {
    const m2 = (value ?? "").match(/^(\S+)\s+(\d+)$/);
    if (!m2) throw new UnaError("grammar", 'count requires "<selector> <number>"', 'usage: una check count "#row" 3');
    const sel = m2[1].startsWith('"') && m2[1].endsWith('"') ? m2[1].slice(1, -1) : m2[1];
    return { kind, expect: sel, ref: m2[2] };
  }
  if (REF_KINDS.has(kind)) {
    const ref = (value ?? "").match(REF_RE)?.[0];
    if (!ref) throw new UnaError("grammar", `${kind} requires a ref like @e1`, `usage: una check ${kind} @e1`);
    return { kind, expect: value ?? "", ref };
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
    if (res.exceptionDetails) return undefined;
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
      const t = ((await evalPage("document.body.innerText")) ?? "") as string;
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
        const objectId = await objectIdFor(session, n.backendNodeId);
        const res = await session.client.send("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: "function(){ const r = this.getBoundingClientRect(); return r.width > 0 && r.height > 0; }",
          returnByValue: true,
        });
        const vis = (res.result as { value?: boolean }).value ?? false;
        actual = vis;
        pass = rule.kind === "visible" ? vis : !vis;
      } catch (err) {
        if (err instanceof UnaError && err.code === "stale_ref") {
          actual = false;
          pass = rule.kind === "hidden";
        } else {
          throw err;
        }
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
    case "state": {
      const st = await detectState(session);
      actual = st.state;
      pass = rule.expect === undefined || rule.expect === "" ? true : st.state === rule.expect;
      break;
    }
  }

  return { verdict: pass ? "PASS" : "FAIL", rule: raw, actual };
}