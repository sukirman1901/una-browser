import { UnaError } from "../errors";
import type { PageSession } from "./session";

export async function objectIdFor(session: PageSession, backendNodeId: number): Promise<string> {
  let res: Record<string, unknown>;
  try {
    res = await session.client.send("DOM.resolveNode", { backendNodeId });
  } catch (err) {
    if (err instanceof UnaError && err.code === "timeout") throw err;
    throw new UnaError("stale_ref", "element no longer exists in DOM", "re-run: una snap");
  }
  const obj = res.object as { objectId?: string } | undefined;
  if (!obj?.objectId) throw new UnaError("stale_ref", "element no longer exists in DOM", "re-run: una snap");
  return obj.objectId;
}

export async function evalOn(session: PageSession, backendNodeId: number, fn: string, args: unknown[] = []): Promise<unknown> {
  const objectId = await objectIdFor(session, backendNodeId);
  const res = await session.client.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: fn,
    arguments: args.map((a) => ({ value: a })),
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new UnaError("cdp", `evaluate error: ${JSON.stringify(res.exceptionDetails)}`);
  }
  return (res.result as { value?: unknown }).value;
}

export async function rectOf(session: PageSession, backendNodeId: number): Promise<{ x: number; y: number; w: number; h: number }> {
  const v = await evalOn(session, backendNodeId, `function(){
    this.scrollIntoView({ block: "center", inline: "center" });
    const r = this.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
  }`);
  return v as { x: number; y: number; w: number; h: number };
}

export async function clickAt(session: PageSession, backendNodeId: number): Promise<void> {
  const r = await rectOf(session, backendNodeId);
  const hit = (await evalOn(session, backendNodeId, `function(x, y){
    if (x <= 0 || y <= 0) return { ok: false };
    const top = document.elementFromPoint(x, y);
    return { ok: !!top && (top === this || this.contains(top)) };
  }`, [r.x, r.y])) as { ok: boolean };
  if (!hit.ok) {
    throw new UnaError("stale_ref", "element is hidden or covered by another element", "re-run: una snap or close overlaying UI first");
  }
  for (const type of ["mousePressed", "mouseReleased"] as const) {
    await session.client.send("Input.dispatchMouseEvent", {
      type, x: r.x, y: r.y, button: "left", clickCount: 1,
    });
  }
}

export async function focusAndGetCurrent(session: PageSession, backendNodeId: number): Promise<string> {
  return (await evalOn(session, backendNodeId, `function(){
    this.focus();
    if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement || this instanceof HTMLSelectElement) return this.value;
    return this.textContent ?? "";
  }`)) as string;
}

export async function insertText(session: PageSession, text: string): Promise<void> {
  await session.client.send("Input.insertText", { text });
}

export async function clearValue(session: PageSession, backendNodeId: number): Promise<void> {
  await evalOn(session, backendNodeId, `function(){
    if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
      const proto = this instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(this, "");
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (this.isContentEditable) { this.textContent = ""; return; }
  }`);
}

export async function selectOption(session: PageSession, backendNodeId: number, value: string): Promise<void> {
  const ok = (await evalOn(session, backendNodeId, `function(value){
    if (!(this instanceof HTMLSelectElement)) return false;
    const opt = Array.from(this.options).find((o) => o.value === value);
    if (!opt) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(this, value);
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }`, [value])) as boolean;
  if (!ok) {
    throw new UnaError("not_found", `option '${value}' not found in select`, "re-run: una snap and pick a valid value");
  }
}

export async function elementText(session: PageSession, backendNodeId: number): Promise<string> {
  return (await evalOn(session, backendNodeId, `function(){ return this.textContent ?? ""; }`)) as string;
}

export async function elementValue(session: PageSession, backendNodeId: number): Promise<string> {
  return (await evalOn(session, backendNodeId, `function(){
    if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement || this instanceof HTMLSelectElement) return this.value;
    return this.textContent ?? "";
  }`)) as string;
}