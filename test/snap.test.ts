import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { startFixture } from "./server";
import { launchChrome, closeChrome, type LaunchedChrome } from "../src/cdp/launcher";
import { PageSession } from "../src/cdp/session";
import { collectAxTree } from "../src/cdp/a11y";
import { serializeSnap } from "../src/view/snap";

let launched: LaunchedChrome;
let server: Server<undefined>;
let session: PageSession;

beforeAll(async () => {
  launched = await launchChrome();
  server = await startFixture(0);
  session = await PageSession.connect(launched.port);
  await session.navigate(`http://127.0.0.1:${server.port}/`);
  await new Promise((r) => setTimeout(r, 200));
});

afterAll(async () => {
  session?.close();
  if (launched) await closeChrome(launched);
  server?.stop();
});

describe("snap serializer", () => {
  it("produces identical output across two snaps (ref stability)", async () => {
    const a = serializeSnap(await collectAxTree(session));
    const b = serializeSnap(await collectAxTree(session));
    expect(a).toBe(b);
  });

  it("interactiveOnly drops headings", async () => {
    const full = serializeSnap(await collectAxTree(session));
    const only = serializeSnap(await collectAxTree(session), { interactiveOnly: true });
    // full line is `heading [level=1] "Una Fixture"` — attrs() inserts level between role and name
    expect(full).toContain("heading");
    expect(full).toContain("Una Fixture");
    expect(only).not.toContain("heading");
  });

  it("depth cap hides deeper elements", async () => {
    const all = serializeSnap(await collectAxTree(session));
    const capped = serializeSnap(await collectAxTree(session), { depth: 0 });
    expect(all).not.toBe(capped);
  });

  it("compact keeps only non-empty interactive lines", async () => {
    const out = serializeSnap(await collectAxTree(session), { compact: true });
    const bad = out.split("\n").find((l) => l.trim() === '""');
    expect(bad).toBeUndefined();
  });
});