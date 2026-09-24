import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { startFixture } from "./server";
import { startDaemon, stopDaemon, healthUrl, type Daemon } from "../src/serve";

let daemon: Daemon;
let server: Server<undefined>;
const PORT = 18500 + Math.floor(Math.random() * 400);
let base = "";

async function cli(cmd: string): Promise<{ ok: boolean; result: unknown }> {
  const r = await fetch(`${healthUrl(PORT)}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cmd }),
  });
  return (await r.json()) as { ok: boolean; result: unknown };
}

beforeAll(async () => {
  server = await startFixture(0);
  base = `http://127.0.0.1:${server.port}`;
  daemon = await startDaemon(PORT);
});

afterAll(async () => {
  await stopDaemon(daemon);
  server?.stop();
});

describe("agent-style E2E", () => {
  it("open → snap → click → check, driven through daemon", async () => {
    const open = await cli(`open ${base}/`);
    expect((open.result as { title: string }).title).toBe("UnaFixture");

    const snap1 = (await cli("snap")).result as string;
    const btnLine = snap1.split("\n").find((l) => l.includes('button "Increment"'))!;
    const ref = btnLine.trim().split(" ")[0];

    await cli(`click ${ref}`);
    await new Promise((r) => setTimeout(r, 60));

    const snap2 = (await cli("snap")).result as string;
    expect(snap2).toContain('"Clicks: 1"');

    const chk = (await cli('check text="Clicks: 1"')).result as { verdict: string };
    expect(chk.verdict).toBe("PASS");
  });

  it("skill returns core rules", async () => {
    const s = (await cli("skill")).result as string;
    expect(s).toContain("Refs only, never selectors");
  });

  it("stale_ref surfaces exit-style error through daemon", async () => {
    const snap = (await cli("snap")).result as string;
    const swapLine = snap.split("\n").find((l) => l.includes('button "Swap"'))!;
    const ref = swapLine.trim().split(" ")[0];
    await cli(`open ${base}/`);
    await new Promise((r) => setTimeout(r, 150));
    const res = await fetch(`${healthUrl(PORT)}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd: `click ${ref}` }),
    });
    const json = (await res.json()) as { ok: boolean; error?: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error?.code).toBe("stale_ref");
  });
});