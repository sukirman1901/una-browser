import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startDaemon, stopDaemon, healthUrl, type Daemon } from "../src/serve";
import type { Server } from "bun";
import { startFixture } from "./server";

let daemon: Daemon | undefined;
let server: Server<undefined>;
const PORT = 18000 + Math.floor(Math.random() * 500);
let idDaemon: Daemon | undefined;
let idPort = 19000 + Math.floor(Math.random() * 500);
let idRoot = "";

beforeAll(async () => {
  server = await startFixture(0);
  daemon = await startDaemon(PORT);
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  idRoot = fs.mkdtempSync(path.join(os.tmpdir(), "una-serve-id-"));
  (process.env as Record<string, string>)["UNA_ROOT"] = idRoot;
  idDaemon = await startDaemon(idPort, { id: "work", mode: "headless" });
});

afterAll(async () => {
  if (daemon) await stopDaemon(daemon);
  if (idDaemon) await stopDaemon(idDaemon);
  const fs = await import("node:fs");
  delete (process.env as Record<string, string>)["UNA_ROOT"];
  fs.rmSync(idRoot, { recursive: true, force: true });
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

  it("named daemon registers in the identity store", async () => {
    const { daemonPort } = await import("../src/identity");
    expect(daemonPort("work")).toBe(idPort);
  });

  it("dispatch by --id proxies to the named daemon", async () => {
    const { run } = await import("../src/serve");
    const r = (await run({ cmd: `open http://127.0.0.1:${server.port}/ --id work` }, "work")) as { url: string; title: string };
    expect(r.title).toBe("UnaFixture");
  });
});