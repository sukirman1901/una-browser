import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { startFixture } from "./server";
import { launchChrome, closeChrome, type LaunchedChrome } from "../src/cdp/launcher";
import { PageSession } from "../src/cdp/session";
import { detectState } from "../src/state/detect";

let launched: LaunchedChrome;
let server: Server<undefined>;
let base = "";

beforeAll(async () => {
  launched = await launchChrome();
  server = await startFixture(0);
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  if (launched) await closeChrome(launched);
  server?.stop();
});

async function stateAt(url: string) {
  const session = await PageSession.connect(launched.port);
  await session.navigate(url);
  await new Promise((r) => setTimeout(r, 300));
  const state = await detectState(session);
  await session.close();
  return state;
}

describe("challenge detector", () => {
  it("plain page → loaded", async () => {
    const s = await stateAt(`${base}/`);
    expect(s).toEqual({ state: "loaded", kind: null });
  });

  it("cloudflare interstitial → challenge/cf", async () => {
    const s = await stateAt(`${base}/challenge-cf`);
    expect(s.state).toBe("challenge");
    expect(s.kind).toBe("cf");
  });

  it("turnstile checkpoint → challenge/cf", async () => {
    const s = await stateAt(`${base}/challenge-turnstile`);
    expect(s.state).toBe("challenge");
    expect(s.kind).toBe("cf");
  });

  it("hcaptcha → challenge/hcaptcha", async () => {
    const s = await stateAt(`${base}/challenge-hcaptcha`);
    expect(s.state).toBe("challenge");
    expect(s.kind).toBe("hcaptcha");
  });

  it("403 → blocked/forbidden", async () => {
    const s = await stateAt(`${base}/block-403`);
    expect(s.state).toBe("blocked");
    expect(s.kind).toBe("forbidden");
  });

  it("429 → blocked/rate", async () => {
    const s = await stateAt(`${base}/block-429`);
    expect(s.state).toBe("blocked");
    expect(s.kind).toBe("rate");
  });

  it("hidden recaptcha script/div (Gmail-like) → loaded, not false positive", async () => {
    const s = await stateAt(`${base}/inbox-hidden-recaptcha`);
    expect(s).toEqual({ state: "loaded", kind: null });
  });

  it("visible recaptcha widget → challenge/captcha", async () => {
    const s = await stateAt(`${base}/challenge-recaptcha`);
    expect(s.state).toBe("challenge");
    expect(s.kind).toBe("captcha");
  });

  it("auto-passing challenge eventually → loaded", async () => {
    const session = await PageSession.connect(launched.port);
    await session.navigate(`${base}/challenge-auto`);
    await new Promise((r) => setTimeout(r, 300));
    const s = await detectState(session);
    expect(s.state).toBe("challenge");
    await new Promise((r) => setTimeout(r, 1500));
    const s2 = await detectState(session);
    await session.close();
    expect(s2.state).toBe("loaded");
  }, 10_000);
});