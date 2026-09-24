import { parseArgs } from "../args";
import { UnaError } from "../errors";
import { parseExpect, type CheckKind } from "../verify/check";
import type { SnapNode } from "../view/snap";

const ALLOWED = new Set(["click", "type", "fill", "select", "check", "get"]);

export type FuseAction =
  | { verb: "click"; ref: string }
  | { verb: "get"; ref: string }
  | { verb: "type"; ref: string; text: string }
  | { verb: "fill"; ref: string; text: string }
  | { verb: "select"; ref: string; value: string }
  | { verb: "check"; rule: string; kind: Exclude<CheckKind, "state">; expect?: string; ref?: string; selector?: string; count?: number };

function normRef(ref: string): string {
  return ref.startsWith("@") ? ref : `@${ref}`;
}

export function parseFuseActions(cmds: string[]): FuseAction[] {
  if (!cmds.length) throw new UnaError("grammar", "fuse needs at least one action", 'usage: una fuse \'["click @e1"]\'');
  return cmds.map((raw) => {
    const c = parseArgs(raw.trim().split(/\s+/));
    if (!ALLOWED.has(c.verb)) {
      throw new UnaError("grammar", `fuse does not support '${c.verb}'`, `supported: ${[...ALLOWED].join(" ")}`);
    }
    if (c.verb === "check") {
      const rule = parseExpect(c.expect);
      if (rule.kind === "state") {
        throw new UnaError("grammar", "fuse check does not support state", "state needs the HTTP challenge detector (use una check state ...)");
      }
      if (rule.kind === "count") {
        return { verb: "check", rule: c.expect, kind: "count", selector: rule.expect, count: Number(rule.ref) };
      }
      if (rule.ref) {
        return { verb: "check", rule: c.expect, kind: rule.kind, ref: normRef(rule.ref), expect: rule.expect };
      }
      return { verb: "check", rule: c.expect, kind: rule.kind, expect: rule.expect };
    }
    if (c.verb === "click" || c.verb === "get") return { verb: c.verb, ref: normRef(c.ref) };
    if (c.verb === "type" || c.verb === "fill") return { verb: c.verb, ref: normRef(c.ref), text: c.text };
    if (c.verb === "select") return { verb: "select", ref: normRef(c.ref), value: c.value };
    throw new UnaError("grammar", `fuse does not support '${c.verb}'`, `supported: ${[...ALLOWED].join(" ")}`);
  });
}

export function buildExpression(
  actions: FuseAction[],
  paths: Record<string, number[]>,
  byRef: Map<string, SnapNode>,
): string {
  const roles: Record<string, string> = {};
  for (const ref of Object.keys(paths)) roles[ref] = byRef.get(ref)?.role ?? "";

  return `(() => {
  const PATHS = ${JSON.stringify(paths)};
  const ROLE = ${JSON.stringify(roles)};
  const ACTIONS = ${JSON.stringify(actions)};
  const results = [];
  let done = 0;
  let first_fail = undefined;
  const resolve = (ref) => {
    const p = PATHS[ref];
    if (!p) return null;
    let el = document.documentElement;
    for (const o of p) { el = el.children[o]; if (!el) return null; }
    return el;
  };
  const setV = (el, v) => {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : null;
    if (proto) { const s = Object.getOwnPropertyDescriptor(proto, "value"); if (s && s.set) s.set.call(el, v); }
    else if (el.isContentEditable) el.textContent = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const tagOK = (ref, el) => {
    const T = {
      button: ["BUTTON", "A", "INPUT", "SPAN"], textbox: ["INPUT", "TEXTAREA"], searchbox: ["INPUT"],
      link: ["A", "BUTTON"], checkbox: ["INPUT"], radio: ["INPUT"], slider: ["INPUT"],
      switch: ["BUTTON", "INPUT", "A"], combobox: ["SELECT", "INPUT"], option: ["OPTION"],
      heading: ["H1", "H2", "H3", "H4", "H5", "H6"], image: ["IMG"], tab: ["BUTTON", "A", "LI"],
      menuitem: ["BUTTON", "A", "LI"],
    };
    const tags = T[ROLE[ref]];
    if (!tags) return true;
    return tags.includes(el.tagName) || el.getAttribute("role") === ROLE[ref];
  };
  for (const a of ACTIONS) {
    try {
      if (a.verb === "check") {
        let pass = false;
        let actual;
        if (a.kind === "text") { actual = document.body.innerText; pass = actual.includes(a.expect ?? ""); }
        else if (a.kind === "url") { actual = location.href; pass = !a.expect || actual === a.expect; }
        else if (a.kind === "count") { actual = document.querySelectorAll(a.selector ?? "").length; pass = actual === a.count; }
        else if (a.kind === "visible" || a.kind === "hidden") { const el = resolve(a.ref); const v = !!el && isVisible(el); actual = v; pass = a.kind === "visible" ? v : !v; }
        else if (a.kind === "input_value") { const el = resolve(a.ref); const v = el ? (el.value ?? el.textContent ?? "") : ""; actual = v; pass = !a.expect ? v !== "" : v === a.expect; }
        results.push({ verdict: pass ? "PASS" : "FAIL", rule: a.rule, actual });
        done++;
        continue;
      }
      const el = resolve(a.ref);
      if (!el || !tagOK(a.ref, el)) throw Object.assign(new Error("element moved or no longer matches the snapshot"), { code: "stale_ref" });
      if (a.verb === "get") {
        results.push({
          ref: a.ref, role: ROLE[a.ref] ?? "",
          text: el.textContent ?? "",
          value: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : undefined,
        });
      } else if (a.verb === "click") {
        el.scrollIntoView({ block: "center", inline: "center" });
        el.click();
        results.push({ ref: a.ref, clicked: true });
      } else if (a.verb === "type") {
        el.focus();
        const cur = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el.value : (el.isContentEditable ? (el.textContent ?? "") : "");
        setV(el, cur + a.text);
        results.push({ ref: a.ref, typed: a.text.length });
      } else if (a.verb === "fill") {
        el.focus();
        setV(el, "");
        setV(el, a.text);
        results.push({ ref: a.ref, filled: a.text.length });
      } else if (a.verb === "select") {
        if (!(el instanceof HTMLSelectElement)) throw Object.assign(new Error("target is not a <select>"), { code: "not_found", hint: "re-run: una snap and pick a select ref" });
        const opt = Array.from(el.options).find((o) => o.value === a.value);
        if (!opt) throw Object.assign(new Error("option '" + a.value + "' not found in select"), { code: "not_found", hint: "re-run: una snap and pick a valid value" });
        setV(el, a.value);
        results.push({ ref: a.ref, selected: a.value });
      } else {
        throw Object.assign(new Error("unsupported action " + a.verb), { code: "grammar" });
      }
      done++;
    } catch (e) {
      first_fail = {
        ref: a.ref ?? null,
        code: (e && e.code) || "cdp",
        message: e instanceof Error ? e.message : String(e),
        hint: (e && e.hint) || undefined,
      };
      break;
    }
  }
  return { ok: !first_fail, done, results, first_fail };
})()`;
}