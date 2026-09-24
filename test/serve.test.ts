import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startDaemon, stopDaemon, healthUrl, type Daemon } from "../src/serve";
import type { Server } from "bun";
import { startFixture } from "./server";

let daemon: Daemon | undefined;
let server: Server<undefined>;
const PORT = 18000 + Math.floor(Math.random() * 500);

beforeAll(async () => {
  server = await startFixture(0);
  daemon = await startDaemon(PORT);
});

afterAll(async () => {
  if (daemon) await stopDaemon(daemon);
  server?.stop();
});

describe("daemon", () => {
  it("healthz responds", async () => {
    const r = await fetch(`${healthUrl(PORT)}/healthz`);
    expect(r.ok).toBe(true);
  });

  it("proxies a command", async () => {
    const r = await fetch(`${healthUrl(PORT)}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd: `open http://127.0.0.1:${server.port}/` }),
    });
    const json = (await r.json()) as { ok: boolean; result: { url: string; title: string } };
    expect(json.ok).toBe(true);
    expect(json.result.title).toBe("UnaFixture");
  });

  it("proxies batch", async () => {
    const r = await fetch(`${healthUrl(PORT)}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commands: ["snap", "check url"] }),
    });
    const json = (await r.json()) as { ok: boolean; result: unknown[] };
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.result)).toBe(true);
  });
});