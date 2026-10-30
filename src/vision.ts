import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { PageSession } from "./cdp/session";
import { UnaError } from "./errors";
import { detectState, type PageState } from "./state/detect";

interface Viewport {
  url: string;
  timeOrigin: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  scale: number;
  revision: number;
}

interface Capture {
  id: string;
  expires: number;
  view: Viewport;
  width: number;
  height: number;
}

export interface VisionObservation extends PageState {
  captureId: string;
  width: number;
  height: number;
  viewport: { width: number; height: number };
  expiresInMs: number;
  mimeType: "image/png";
  data?: string;
  path?: string;
}

const LIFETIME = 30_000;
const OBSERVE_VIEW = `(() => {
  const key = Symbol.for("una.vision.revision.v1");
  let tracker = globalThis[key];
  if (!tracker) {
    tracker = { revision: 0 };
    const changed = () => { tracker.revision++; };
    tracker.observer = new MutationObserver(changed);
    tracker.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    document.addEventListener("input", changed, true);
    document.addEventListener("change", changed, true);
    globalThis[key] = tracker;
  }
  if (tracker.observer.takeRecords().length) tracker.revision++;
  return {url:location.href,timeOrigin:performance.timeOrigin,width:innerWidth,height:innerHeight,scrollX,scrollY,scale:visualViewport?.scale??1,revision:tracker.revision};
})()`;

async function viewport(session: PageSession): Promise<Viewport> {
  const res = await session.client.send("Runtime.evaluate", { expression: OBSERVE_VIEW, returnByValue: true });
  const v = (res.result as { value?: Viewport } | undefined)?.value;
  if (res.exceptionDetails || !v || typeof v.url !== "string" ||
    ![v.timeOrigin, v.width, v.height, v.scrollX, v.scrollY, v.scale, v.revision].every(Number.isFinite) ||
    v.width <= 0 || v.height <= 0 || v.scale !== 1) {
    throw new UnaError("cdp", "cannot establish an unscaled visual viewport", "reset pinch zoom and observe again");
  }
  return v;
}

function sameView(a: Viewport, b: Viewport): boolean {
  return a.url === b.url && a.timeOrigin === b.timeOrigin && a.width === b.width &&
    a.height === b.height && a.scrollX === b.scrollX && a.scrollY === b.scrollY && a.scale === b.scale && a.revision === b.revision;
}

function stale(): UnaError {
  return new UnaError("stale_ref", "visual capture is stale, consumed, or belongs to another tab", "run: una vision observe, inspect the new image, then use its captureId");
}

/** Screenshot/input bridge. The connected agent, not this module, supplies visual reasoning. */
export class VisionControl {
  private captures = new WeakMap<PageSession, Capture>();
  private generations = new WeakMap<PageSession, number>();

  constructor(private readonly now: () => number = Date.now) {}

  invalidate(session: PageSession): void {
    this.captures.delete(session);
    this.generations.set(session, (this.generations.get(session) ?? 0) + 1);
  }

  async observe(session: PageSession, path?: string): Promise<VisionObservation> {
    this.invalidate(session);
    const generation = this.generations.get(session);
    const started = this.now();
    const view = await viewport(session);
    const state = await detectState(session);
    const shot = await session.client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    if (typeof shot.data !== "string" || shot.data.length > 24_000_000) throw new UnaError("cdp", "invalid or oversized visual screenshot");
    const png = Buffer.from(shot.data, "base64");
    if (png.length < 24 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new UnaError("cdp", "visual screenshot is not a PNG");
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (!width || !height) throw new UnaError("cdp", "visual screenshot has empty dimensions");
    if (!sameView(view, await viewport(session)) || generation !== this.generations.get(session) || this.now() - started >= LIFETIME) throw stale();
    const id = randomUUID();
    // An explicit path is opt-in, private, and never overwrites an existing file.
    if (path) writeFileSync(path, png, { mode: 0o600, flag: "wx" });
    this.captures.set(session, { id, expires: started + LIFETIME, view, width, height });
    return {
      captureId: id, width, height, viewport: { width: view.width, height: view.height },
      expiresInMs: Math.max(0, started + LIFETIME - this.now()), mimeType: "image/png", ...state,
      ...(path ? { path } : { data: shot.data }),
    };
  }

  async click(session: PageSession, captureId: string, x: number, y: number): Promise<{ clicked: true; requiresObservation: true }> {
    const capture = this.captures.get(session);
    if (!capture || capture.id !== captureId) throw stale();
    // Consume before any await so concurrent calls cannot reuse the same image.
    this.invalidate(session);
    if (this.now() >= capture.expires) throw stale();
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= capture.width || y >= capture.height) {
      throw new UnaError("invalid", "visual coordinates must be within the observed screenshot");
    }
    const current = await viewport(session);
    if (!sameView(capture.view, current) || this.now() >= capture.expires) throw stale();
    const cssX = x * current.width / capture.width;
    const cssY = y * current.height / capture.height;
    // Native viewport input reaches visible iframe content without reading its DOM.
    await session.client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cssX, y: cssY });
    try {
      await session.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cssX, y: cssY, button: "left", buttons: 1, clickCount: 1 });
    } finally {
      await session.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cssX, y: cssY, button: "left", buttons: 0, clickCount: 1 });
    }
    return { clicked: true, requiresObservation: true };
  }
}
