import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/args";
import { startDaemon, stopDaemon } from "../src/serve";

test("eye toggle is keyboard accessible and stays inside input at mobile and desktop sizes", async () => {
  const root = mkdtempSync(join(tmpdir(), "una-eye-browser-"));
  const previous = process.env.UNA_ROOT;
  process.env.UNA_ROOT = root;
  let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
  try {
    daemon = await startDaemon(0);
    await daemon.controller.exec(parseArgs(["open", daemon.vaultUi.url]));
    const snap = String(await daemon.controller.exec(parseArgs(["snap", "-c"])));
    const ref = snap.match(/(@e\d+) button "Show password"/)?.[1];
    expect(ref).toBeDefined();
    await daemon.controller.exec(parseArgs(["eval", "document.getElementById('passphrase').focus()"]));
    await daemon.controller.exec(parseArgs(["press", "Tab"]));
    const focus = await daemon.controller.exec(parseArgs(["eval", "document.activeElement.getAttribute('aria-label')"]));
    expect(focus).toMatchObject({ value: "Show password" });
    const pressSpace = async () => {
      for (const type of ["keyDown", "keyUp"]) {
        await daemon!.controller.session.client.send("Input.dispatchKeyEvent", { type, key: " ", code: "Space", text: " ", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
      }
    };
    await pressSpace();
    const shown = await daemon.controller.exec(parseArgs(["eval", "({type:document.getElementById('passphrase').type,pressed:document.querySelector('[data-password-toggle=passphrase]').getAttribute('aria-pressed'),label:document.querySelector('[data-password-toggle=passphrase]').getAttribute('aria-label')})"]));
    expect(shown).toMatchObject({ value: { type: "text", pressed: "true", label: "Hide password" } });
    const fresh = String(await daemon.controller.exec(parseArgs(["snap", "-c"])));
    const hideRef = fresh.match(/(@e\d+) button "Hide password"/)?.[1];
    expect(hideRef).toBeDefined();
    expect(await daemon.controller.exec(parseArgs(["eval", "document.activeElement.getAttribute('aria-label')"]))).toMatchObject({ value: "Hide password" });
    await pressSpace();
    const hidden = await daemon.controller.exec(parseArgs(["eval", "({type:document.getElementById('passphrase').type,label:document.querySelector('[data-password-toggle=passphrase]').getAttribute('aria-label')})"]));
    expect(hidden).toMatchObject({ value: { type: "password", label: "Show password" } });

    for (const theme of ["light", "dark"]) {
      await daemon.controller.session.client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
      for (const width of [320, 768, 1024, 1440]) {
        await daemon.controller.session.client.send("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false });
        const layout = await daemon.controller.exec(parseArgs(["eval", "(()=>{const input=document.getElementById('passphrase').getBoundingClientRect(),eye=document.querySelector('[data-password-toggle=passphrase]').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,inside:eye.left>=input.left&&eye.right<=input.right,touch:eye.width>=44&&eye.height>=44,padding:parseFloat(getComputedStyle(document.getElementById('passphrase')).paddingRight)>=44,bg:getComputedStyle(document.documentElement).backgroundColor}})()"]));
        expect(layout).toMatchObject({ value: { overflow: false, inside: true, touch: true, padding: true, bg: theme === "light" ? "rgb(255, 255, 255)" : "rgb(9, 9, 11)" } });
        const tone = await daemon.controller.exec(parseArgs(["eval", "({title:getComputedStyle(document.querySelector('h1')).color,weight:getComputedStyle(document.querySelector('h1')).fontWeight,cta:getComputedStyle(document.querySelector('button[type=submit]')).backgroundColor})"]));
        expect(tone).toMatchObject({ value: { title: theme === "light" ? "rgb(82, 82, 91)" : "rgb(180, 180, 189)", weight: "550", cta: theme === "light" ? "rgb(82, 82, 91)" : "rgb(180, 180, 189)" } });
      }
    }
  } finally {
    if (daemon) await stopDaemon(daemon);
    if (previous === undefined) delete process.env.UNA_ROOT;
    else process.env.UNA_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
