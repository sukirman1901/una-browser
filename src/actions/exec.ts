import type { PageSession } from "../cdp/session";
import { UnaError } from "../errors";
import { collectAxTree } from "../cdp/a11y";
import { serializeSnap, type SnapNode } from "../view/snap";
import { clickAt, insertText, focusAndGetCurrent, clearValue, selectOption, elementText, elementValue, evalOn } from "../cdp/dom";
import type { Command } from "../args";

export class Controller {
  private tree: SnapNode[] = [];
  private byRef = new Map<string, SnapNode>();

  constructor(private session: PageSession) {}

  private async refresh(): Promise<void> {
    this.tree = await collectAxTree(this.session);
    this.byRef.clear();
    for (const n of this.tree) this.byRef.set(n.ref, n);
  }

  private node(ref: string): SnapNode {
    const key = ref.startsWith("@") ? ref : `@${ref}`;
    const n = this.byRef.get(key);
    if (!n) throw new UnaError("stale_ref", `ref ${ref} not in current snapshot`, "re-run: una snap");
    return n;
  }

  async exec(cmd: Command): Promise<unknown> {
    switch (cmd.verb) {
      case "open":
        await this.session.navigate(cmd.url);
        await this.waitForLoad();
        return this.session.current();
      case "snap": {
        await this.refresh();
        const snapshot = serializeSnap(this.tree, {
          interactiveOnly: cmd.interactiveOnly,
          urls: cmd.urls,
          compact: cmd.compact,
          depth: cmd.depth,
        });
        return snapshot;
      }
      case "click": {
        const n = this.node(cmd.ref);
        await clickAt(this.session, n.backendNodeId);
        return { ok: true, clicked: n.ref };
      }
      case "type": {
        const n = this.node(cmd.ref);
        await focusAndGetCurrent(this.session, n.backendNodeId);
        await insertText(this.session, cmd.text);
        return { ok: true, typed: cmd.text.length };
      }
      case "fill": {
        const n = this.node(cmd.ref);
        await clearValue(this.session, n.backendNodeId);
        await focusAndGetCurrent(this.session, n.backendNodeId);
        await insertText(this.session, cmd.text);
        return { ok: true, filled: cmd.text.length };
      }
      case "select": {
        const n = this.node(cmd.ref);
        await selectOption(this.session, n.backendNodeId, cmd.value);
        return { ok: true, selected: cmd.value };
      }
      case "scroll":
        await this.scroll(cmd.dir, cmd.px);
        return { ok: true, dir: cmd.dir, px: cmd.px };
      case "wait":
        await this.wait(cmd.target);
        return { waited: cmd.target };
      case "get": {
        const n = this.node(cmd.ref);
        return { ref: n.ref, role: n.role, text: await elementText(this.session, n.backendNodeId) };
      }
      case "check":
        return this.check(cmd.expect);
      case "shot": {
        const path = cmd.path ?? `una-${Date.now()}.png`;
        await this.shot(path);
        return { path };
      }
      case "batch":
        return this.batch(cmd.cmds);
      case "skill":
        return this.skill();
      case "serve":
        throw new UnaError("grammar", "serve is daemon-only", "call: una serve");
    }
  }

  private async waitForLoad(): Promise<void> {
    await new Promise((r) => setTimeout(r, 150));
  }

  private async scroll(dir: "up" | "down" | "left" | "right", px: number): Promise<void> {
    const code = `function(dir, px) {
      const x = dir === "left" ? -px : dir === "right" ? px : 0;
      const y = dir === "up" ? -px : dir === "down" ? px : 0;
      window.scrollBy({ left: x, top: y, behavior: "instant" });
    }`;
    await this.session.client.send("Runtime.evaluate", {
      expression: `(${code})(` + JSON.stringify(dir) + `,` + String(px) + `)`,
      returnByValue: true,
    });
  }

  private async wait(target: string): Promise<void> {
    const ms = Number(target);
    if (Number.isFinite(ms)) {
      await new Promise((r) => setTimeout(r, ms));
      return;
    }
    if (target === "load") {
      // Page.loadEventFired may already have fired; just settle briefly
      await new Promise((r) => setTimeout(r, 100));
      return;
    }
    const deadline = Date.now() + 10_000;
    // scope cut: wait polls document.querySelector presence only (assertion-context, like check.count);
    // it does NOT assert interactivity or resolve refs — presence is the whole contract in v1.
    for (;;) {
      const res = await this.session.client.send("Runtime.evaluate", {
        expression: `!!document.querySelector(${JSON.stringify(target)})`,
        returnByValue: true,
      });
      if ((res.result as { value?: boolean }).value === true) return;
      if (Date.now() > deadline) throw new UnaError("timeout", `wait for '${target}' timed out`, "check selector");
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  private async shot(path: string): Promise<void> {
    const res = await this.session.client.send("Page.captureScreenshot", { format: "png" });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, Buffer.from(res.data as string, "base64"));
  }

  private async check(expect: string): Promise<unknown> {
    const { runChecks } = await import("../verify/check");
    return runChecks(this.session, this.byRef, expect);
  }

  private async batch(cmds: string[]): Promise<unknown[]> {
    const { runBatch } = await import("../parallel/batch");
    return runBatch(this, cmds);
  }

  private async skill(): Promise<string> {
    const { readFileSync } = await import("node:fs");
    return readFileSync(new URL("../skills/core.md", import.meta.url), "utf8");
  }
}