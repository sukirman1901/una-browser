import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { startFixture } from "./server";
import { launchChrome, closeChrome, type LaunchedChrome } from "../src/cdp/launcher";
import { PageSession } from "../src/cdp/session";
import { clickAt, insertText, selectOption, focusAndGetCurrent, clearValue, elementValue } from "../src/cdp/dom";

let launched: LaunchedChrome;
let server: Server<undefined>;
let session: PageSession;

async function backendIdOf(selector: string): Promise<number> {
  const res = await session.client.send("DOM.getDocument");
  const root = (res.root as { nodeId: number }).nodeId;
  const found = await session.client.send("DOM.querySelector", { nodeId: root, selector });
  const desc = await session.client.send("DOM.describeNode", { nodeId: found.nodeId });
  return (desc.node as { backendNodeId: number }).backendNodeId;
}

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

describe("dom helpers", () => {
  it("click increments the counter", async () => {
    const id = await backendIdOf("#btn");
    await clickAt(session, id);
    await new Promise((r) => setTimeout(r, 50));
    const count = await elementValue(session, await backendIdOf("#count"));
    expect(count).toBe("Clicks: 1");
  });

  it("type appends text via Input.insertText", async () => {
    await session.navigate(`http://127.0.0.1:${server.port}/form`);
    await new Promise((r) => setTimeout(r, 200));
    const id = await backendIdOf("#name");
    await focusAndGetCurrent(session, id);
    await insertText(session, "Rudi");
    const v = await elementValue(session, await backendIdOf("#name"));
    expect(v).toBe("Rudi");
  });

  it("selectOption picks a value", async () => {
    const selId = await backendIdOf("#city");
    await focusAndGetCurrent(session, selId);
    await selectOption(session, selId, "bdo");
    const v = await elementValue(session, selId);
    expect(v).toBe("bdo");
  });

  it("clearValue clears text input", async () => {
    const id = await backendIdOf("#name");
    await clearValue(session, id);
    const v = await elementValue(session, id);
    expect(v).toBe("");
  });
});