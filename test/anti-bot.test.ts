import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { startFixture } from "./server";
import { launchChrome, closeChrome, type LaunchedChrome } from "../src/cdp/launcher";
import { PageSession } from "../src/cdp/session";
import { Controller } from "../src/actions/exec";

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
  if (ctrl) (ctrl as unknown as { session: PageSession }).session.close();
  if (launched) await closeChrome(launched);
  server?.stop();
});

async function snapOnce(): Promise<string> {
  return (await ctrl.exec({ verb: "snap", interactiveOnly: false, scopes: [], urls: false, compact: false, depth: 32 })) as string;
}

function refOf(snapLines: string, needle: string): string {
  const line = snapLines.split("\n").find((l) => l.includes(needle));
  if (!line) throw new Error(`not in snapshot: ${needle}\n${snapLines}`);
  return line.trim().split(" ")[0].replace(/^@e/, "e");
}

describe("anti-bot behavior", () => {
  it("open reports challenge state on cloudflare page", async () => {
    const r = (await ctrl.exec({ verb: "open", url: `${base}/challenge-cf` })) as { state: string; kind: string };
    expect(r.state).toBe("challenge");
    expect(r.kind).toBe("cf");
  });

  it("actions on a challenge page error with code challenge", async () => {
    await ctrl.exec({ verb: "open", url: `${base}/challenge-cf` });
    const snap = await snapOnce();
    const ref = refOf(snap, "button"); // the challenge-form submit button
    await expect(ctrl.exec({ verb: "click", ref: `@${ref}` })).rejects.toMatchObject({ code: "challenge" });
  });

  it("wait resolve passes once the challenge auto-clears", async () => {
    await ctrl.exec({ verb: "open", url: `${base}/challenge-auto` });
    const r = (await ctrl.exec({ verb: "wait", target: "resolve", timeout: 8000 })) as { state: string };
    expect(r.state).toBe("loaded");
  }, 12_000);

  it("wait resolve leaves challenge when stuck", async () => {
    await ctrl.exec({ verb: "open", url: `${base}/challenge-cf` });
    const r = (await ctrl.exec({ verb: "wait", target: "resolve", timeout: 1000 })) as { state: string };
    expect(r.state).toBe("challenge");
  }, 5_000);
});