import { describe, expect, it } from "bun:test";
import { idPort } from "../src/identity";

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