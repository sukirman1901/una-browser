import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { startFixture } from "./server";
import { launchChrome, closeChrome, type LaunchedChrome } from "../src/cdp/launcher";
import { PageSession } from "../src/cdp/session";
import { Controller } from "../src/actions/exec";
import { runBatch } from "../src/parallel/batch";

let launched: LaunchedChrome;
let server: Server<undefined>;
let ctrl: Controller;
let base = "";

beforeAll(async () => {
  launched = await launchChrome();
  server = await startFixture(0);
  base = `http://127.0.0.1:${server.port}`;
  const session = await PageSession.connect(launched.port);
  ctrl = new Controller(session);
});

afterAll(async () => {
  ctrl && (ctrl as unknown as { session: PageSession }).session.close();
  if (launched) await closeChrome(launched);
  server?.stop();
});

describe("batch", () => {
  it("runs many commands in one process", async () => {
    const res = await runBatch(ctrl, [`open ${base}/`, "snap", 'check text="Una Fixture"']);
    expect(res.every((r) => r.ok)).toBe(true);
    expect(res[1].result).toContain('button "Increment"');
    expect(res[2].result).toHaveProperty("verdict", "PASS");
  });

  it("continues after a failing command", async () => {
    const res = await runBatch(ctrl, ["bogus-verb x", "snap"]);
    expect(res[0].ok).toBe(false);
    expect(res[1].ok).toBe(true);
  });
});