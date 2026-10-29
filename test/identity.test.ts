import { describe, expect, it, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonPort, idPort, registerDaemon } from "../src/identity";

describe("idPort", () => {
  it("never collides with the default PORT (17911)", () => {
    for (const id of ["gmail", "testcf", "smoke", "a", "zz", "main", ""]) {
      expect(idPort(id)).not.toBe(17911);
    }
  });

  it("is deterministic per id", () => {
    expect(idPort("gmail")).toBe(idPort("gmail"));
    expect(idPort("testcf")).toBe(idPort("testcf"));
  });

  it("distinguishes different ids (very low collision chance)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const port = idPort(`id-${i}`);
      expect(port).toBeGreaterThanOrEqual(17912);
      expect(port).toBeLessThanOrEqual(17912 + 4096 - 1);
      seen.add(port);
    }
    // 500 ids across 4096 slots: expect high uniqueness; exact 500 would be
    // astronomically unlikely but collision-free is not guaranteed — assert a
    // sane floor so a broken (e.g. constant) hash fails loudly.
    expect(seen.size).toBeGreaterThan(450);
  });
});

describe("daemon registration", () => {
  const roots: string[] = [];
  function temp(): string {
    const d = mkdtempSync(join(tmpdir(), "una-identity-"));
    process.env.UNA_ROOT = d;
    roots.push(d);
    return d;
  }

  test("dead daemon registrations are pruned; live ones are kept", () => {
    const root = temp();
    const file = join(root, "daemons", "gone.json");
    try {
      // A dead pid: use a process that already exited.
      const proc = Bun.spawnSync(["/usr/bin/true"], {});
      const deadPid = proc.pid;
      registerDaemon({ id: "gone", port: 18501, mode: "headless", pid: deadPid });
      expect(existsSync(file)).toBe(true);
      expect(daemonPort("gone")).toBe(null); // pruned on read
      expect(existsSync(file)).toBe(false);

      registerDaemon({ id: "alive", port: 18502, mode: "headless", pid: process.pid });
      expect(daemonPort("alive")).toBe(18502);
      expect(existsSync(join(root, "daemons", "alive.json"))).toBe(true);
      expect(JSON.parse(readFileSync(join(root, "daemons", "alive.json"), "utf8") as string)).toEqual({ id: "alive", port: 18502, mode: "headless", pid: process.pid });
    } finally {
      rmSync(root, { recursive: true, force: true });
      roots.pop();
      delete process.env.UNA_ROOT;
    }
  });
});
