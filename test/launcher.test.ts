import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { closeChrome, launchChrome } from "../src/cdp/launcher";
import { PageSession } from "../src/cdp/session";

let tempDir = "";

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "una-launch-"));
  (process.env as Record<string, string>)["UNA_ROOT"] = tempDir;
});

afterAll(async () => {
  delete (process.env as Record<string, string>)["UNA_ROOT"];
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("launcher harness", () => {
  it("temp profile is deleted on close", async () => {
    const launched = await launchChrome();
    const dir = launched.userDataDir!;
    expect(launched.temp).toBe(true);
    expect(launched.proc).toBeDefined();
    await closeChrome(launched);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("named profile dir survives close (persistence)", async () => {
    const launched = await launchChrome({ id: "persist-me" });
    const dir = launched.userDataDir!;
    expect(launched.temp).toBe(false);
    expect(dir).toBe(path.join(tempDir, "profiles", "persist-me"));
    await closeChrome(launched);
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("headed mode omits --headless=new", async () => {
    const launched = await launchChrome({ mode: "headed" });
    await PageSession.connect(launched.port);
    await closeChrome(launched);
  });

  it("attach mode connects to an externally launched Chrome", async () => {
    const ext = await launchChrome();
    const attached = await launchChrome({ mode: `attach:${ext.port}` });
    expect(attached.proc).toBeUndefined();
    const session = await PageSession.connect(attached.port);
    await session.close();
    await closeChrome(ext);
  });

  it("route passes --proxy-server flag", async () => {
    fs.writeFileSync(path.join(tempDir, "routes.json"), JSON.stringify({ us1: { proxy: "socks5://127.0.0.1:1080" } }));
    const launched = await launchChrome({ route: "us1" });
    expect(launched.proxyArgs).toContain("--proxy-server=socks5://127.0.0.1:1080");
    await closeChrome(launched);
  });
});