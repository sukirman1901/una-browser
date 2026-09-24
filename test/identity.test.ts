import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  daemonPort, profileDir, profileUaPath, registerDaemon, routeByName,
} from "../src/identity";

let root = "";

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "una-root-"));
  (process.env as Record<string, string>)["UNA_ROOT"] = root;
});

afterAll(() => {
  delete (process.env as Record<string, string>)["UNA_ROOT"];
  fs.rmSync(root, { recursive: true, force: true });
});

describe("identity store", () => {
  it("profileDir resolves under UNA_ROOT", () => {
    expect(profileDir("work")).toBe(path.join(root, "profiles", "work"));
  });

  it("registerDaemon + daemonPort round-trips", () => {
    registerDaemon({ id: "work", port: 19123, mode: "headed", pid: 99 });
    expect(daemonPort("work")).toBe(19123);
  });

  it("daemonPort(null on missing)", () => {
    expect(daemonPort("nope")).toBeNull();
  });

  it("routeByName finds only human-authored names", () => {
    fs.writeFileSync(path.join(root, "routes.json"), JSON.stringify({ us1: { proxy: "socks5://127.0.0.1:1080" } }));
    expect(routeByName("us1")?.proxy).toBe("socks5://127.0.0.1:1080");
    expect(routeByName("nope")).toBeNull();
  });

  it("profileUaPath resolves", () => {
    expect(profileUaPath("work")).toBe(path.join(root, "ua", "work"));
  });
});