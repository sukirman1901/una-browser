import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { startFixture } from "./server";
import { launchChrome, closeChrome, type LaunchedChrome } from "../src/cdp/launcher";
import { PageSession } from "../src/cdp/session";
import { Controller } from "../src/actions/exec";
import { parseExpect } from "../src/verify/check";

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

describe("check grammar", () => {
  it("parses text/count/input_value", () => {
    expect(parseExpect('text="System One"')).toEqual({ kind: "text", expect: "System One", ref: undefined });
    expect(parseExpect('count "#row" 3')).toEqual({ kind: "count", expect: "#row", ref: "3" });
    expect(parseExpect('input_value @e4="Rudi"')).toEqual({ kind: "input_value", expect: "Rudi", ref: "@e4" });
  });
  it("rejects unknown kind", () => {
    expect(() => parseExpect("banana x")).toThrow("unknown check kind");
  });
});

describe("check vs live DOM", () => {
  it("text PASS on real body text", async () => {
    await ctrl.exec({ verb: "open", url: `${base}/` });
    const r = (await ctrl.exec({ verb: "check", expect: 'text="Una Fixture"' })) as { verdict: string };
    expect(r.verdict).toBe("PASS");
  });
  it("text FAIL on missing string", async () => {
    const r = (await ctrl.exec({ verb: "check", expect: 'text="unicorn XYZ"' })) as { verdict: string };
    expect(r.verdict).toBe("FAIL");
  });
  it("url PASS/FAIL", async () => {
    const r1 = (await ctrl.exec({ verb: "check", expect: "url" })) as { verdict: string };
    expect(r1.verdict).toBe("PASS");
    const r2 = (await ctrl.exec({ verb: "check", expect: `url="${base}/x"` })) as { verdict: string };
    expect(r2.verdict).toBe("FAIL");
  });
  it("visible ref PASS", async () => {
    await ctrl.exec({ verb: "open", url: `${base}/` });
    const snap = (await ctrl.exec({ verb: "snap", interactiveOnly: false, scopes: [], urls: false, compact: false, depth: 32 })) as string;
    const linkLine = snap.split("\n").find((l) => l.includes('link "Go to form"'))!;
    const ref = linkLine.trim().split(" ")[0];
    const rv = (await ctrl.exec({ verb: "check", expect: `visible ${ref}` })) as { verdict: string };
    expect(rv.verdict).toBe("PASS");
  });

  it("count PASS/FAIL vs live DOM", async () => {
    await ctrl.exec({ verb: "open", url: `${base}/` });
    const r1 = (await ctrl.exec({ verb: "check", expect: 'count "button" 2' })) as { verdict: string };
    expect(r1.verdict).toBe("PASS");
    const r2 = (await ctrl.exec({ verb: "check", expect: 'count "button" 99' })) as { verdict: string };
    expect(r2.verdict).toBe("FAIL");
  });
  it("input_value equality vs live field", async () => {
    await ctrl.exec({ verb: "open", url: `${base}/form` });
    const snap = (await ctrl.exec({ verb: "snap", interactiveOnly: false, scopes: [], urls: false, compact: false, depth: 32 })) as string;
    const inputLine = snap.split("\n").find((l) => l.includes("input"))!;
    const ref = inputLine.trim().split(" ")[0];
    await ctrl.exec({ verb: "fill", ref, text: "Rudi" });
    const rv = (await ctrl.exec({ verb: "check", expect: `input_value ${ref}="Rudi"` })) as { verdict: string };
    expect(rv.verdict).toBe("PASS");
  });
});