import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { startFixture } from "./server";
import { launchChrome, closeChrome, type LaunchedChrome } from "../src/cdp/launcher";
import { PageSession } from "../src/cdp/session";
import { collectAxTree } from "../src/cdp/a11y";

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

describe("a11y collect", () => {
  it("finds heading + link + buttons", async () => {
    const tree = await collectAxTree(session);
    const roles = tree.map((n) => n.role);
    expect(roles).toContain("heading");
    expect(roles).toContain("link");
    expect(roles.filter((r) => r === "button").length).toBe(2);
  });

  it("does not leak static text or hidden content", async () => {
    const tree = await collectAxTree(session);
    const names = tree.map((n) => n.name).join(" ");
    expect(names).not.toContain("hidden text");   // display:none is not in a11y tree
    expect(names).toContain("Clicks: 0");         // <p role="status"> live region is a kept role now
  });

  it("assigns sequential stable refs @e1..", async () => {
    const tree = await collectAxTree(session);
    expect(tree[0].ref).toBe("@e1");
    for (let i = 1; i < tree.length; i++) {
      expect(tree[i].ref).toBe(`@e${i + 1}`);
    }
  });

  it("reads checked state and image role from the AX tree", async () => {
    const tree = await collectAxTree(session);
    const opt = tree.find((n) => n.role === "checkbox");
    expect(opt?.checked).toBe(true);
    const img = tree.find((n) => n.role === "image");
    expect(img?.name).toBe("Una logo");
  });
});