import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChrome, closeChrome, type LaunchedChrome } from "../src/cdp/launcher";
import { PageSession } from "../src/cdp/session";
import { Controller } from "../src/actions/exec";
import { parseArgs } from "../src/args";
import { startFixture } from "./server";
import { VisionControl } from "../src/vision";

interface Observation {
  captureId: string; width: number; height: number;
  viewport: { width: number; height: number };
  state: string; kind: string | null; data?: string; path?: string;
}
let chrome: LaunchedChrome;
let server: Server<undefined>;
let ctrl: Controller;
let base: string;
let root: string;
const run = (args: string[]) => ctrl.exec(parseArgs(args));
const observe = async () => await run(["vision", "observe"]) as Observation;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "una-vision-"));
  chrome = await launchChrome();
  server = await startFixture(0);
  base = `http://127.0.0.1:${server.port}`;
  ctrl = new Controller(await PageSession.connect(chrome.port));
}, 15_000);
afterAll(async () => {
  if (chrome) await closeChrome(chrome);
  server?.stop();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("agent vision", () => {
  it("returns a real viewport PNG and challenge status without claiming success", async () => {
    await run(["open", `${base}/vision-challenge`]);
    const v = await observe();
    expect(v.state).toBe("challenge");
    expect(v.kind).toBe("captcha");
    expect(v.captureId).toBeString();
    expect(v.width).toBeGreaterThan(0);
    expect(v.height).toBeGreaterThan(0);
    const png = Buffer.from(v.data!, "base64");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(v.width);
  });

  it("saves a CLI observation without dumping image data into the response", async () => {
    const path = join(root, "capture.png");
    const v = await run(["vision", "observe", path]) as Observation;
    expect(v.path).toBe(path);
    expect(v.data).toBeUndefined();
    expect(readFileSync(path).readUInt32BE(16)).toBe(v.width);
  });

  it("native input reaches a sandboxed cross-origin iframe and consumes its capture", async () => {
    await run(["open", `${base}/vision-challenge`]);
    const v = await observe();
    const x = 80 * v.width / v.viewport.width;
    const y = 100 * v.height / v.viewport.height;
    expect(await run(["vision", "click", v.captureId, String(x), String(y)])).toMatchObject({ clicked: true, requiresObservation: true });
    await run(["wait", "100"]);
    expect(await run(["check", 'text="Fixture solved"'])).toMatchObject({ verdict: "PASS" });
    await expect(run(["vision", "click", v.captureId, String(x), String(y)])).rejects.toMatchObject({ code: "stale_ref" });
    expect((await observe()).state).toBe("loaded");
  });

  it("rejects out-of-image coordinates", async () => {
    const v = await observe();
    await expect(run(["vision", "click", v.captureId, String(v.width), "0"])).rejects.toMatchObject({ code: "invalid" });
  });

  it("new observations replace older capture IDs", async () => {
    const v = await observe();
    await observe();
    await expect(run(["vision", "click", v.captureId, "10", "10"])).rejects.toMatchObject({ code: "stale_ref" });
  });

  it("controller actions invalidate pending visual input", async () => {
    const v = await observe();
    await run(["eval", "1"]);
    await expect(run(["vision", "click", v.captureId, "10", "10"])).rejects.toMatchObject({ code: "stale_ref" });
  });

  it("rejects page navigation outside the controller", async () => {
    const v = await observe();
    await ctrl.session.navigate(`${base}/page2`);
    await expect(run(["vision", "click", v.captureId, "10", "10"])).rejects.toMatchObject({ code: "stale_ref" });
  });

  it("rejects DOM changes outside the controller", async () => {
    const v = await observe();
    await ctrl.session.client.send("Runtime.evaluate", { expression: 'document.body.insertAdjacentHTML("beforeend","<button>New overlay</button>")' });
    await expect(run(["vision", "click", v.captureId, "10", "10"])).rejects.toMatchObject({ code: "stale_ref" });
  });

  it("expires captures after 30 seconds", async () => {
    let now = 1000;
    const vision = new VisionControl(() => now);
    const v = await vision.observe(ctrl.session);
    now += 30_000;
    await expect(vision.click(ctrl.session, v.captureId, 10, 10)).rejects.toMatchObject({ code: "stale_ref" });
  });

  it("does not accept a capture from another session", async () => {
    const vision = new VisionControl();
    const v = await vision.observe(ctrl.session);
    const other = await PageSession.connect(chrome.port);
    try {
      await expect(vision.click(other, v.captureId, 10, 10)).rejects.toMatchObject({ code: "stale_ref" });
    } finally { await other.close(); }
  });

  it("maps screenshot pixels correctly with a high device scale factor", async () => {
    await ctrl.session.client.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 2, mobile: false });
    try {
      await run(["open", `${base}/vision-challenge`]);
      const v = await observe();
      expect(v.width / v.viewport.width).toBe(2);
      await run(["vision", "click", v.captureId, String(80 * v.width / v.viewport.width), String(100 * v.height / v.viewport.height)]);
      await run(["wait", "100"]);
      expect(await run(["check", 'text="Fixture solved"'])).toMatchObject({ verdict: "PASS" });
    } finally { await ctrl.session.client.send("Emulation.clearDeviceMetricsOverride"); }
  });
});
