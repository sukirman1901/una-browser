import type { PageSession } from "../cdp/session";
import { UnaError } from "../errors";
import { collectAxTree } from "../cdp/a11y";
import { serializeSnap, type SnapNode } from "../view/snap";
import { clickAt, insertText, focusAndGetCurrent, clearValue, selectOption, elementText, elementValue, evalOn, pressKey } from "../cdp/dom";
import type { Command } from "../args";
import { detectState, type PageState } from "../state/detect";
import { TabManager, firstSlot, type TabSlot } from "../tabs";
import type { ParallelJob } from "../parallel/tabs";
import type { VaultBinding } from "../vault/manager";
import { matchesOrigin, normalizeOrigin } from "../vault/match";
import { locateLoginForm } from "../vault/form";

export class Controller {
  readonly tabs: TabManager;

  constructor(session: PageSession, tabs?: TabManager, private readonly vault?: VaultBinding, private readonly vaultUiUrl?: () => string) {
    this.tabs = tabs ?? new TabManager(0, firstSlot(session));
  }

  get session(): PageSession {
    return this.tabs.focused().session;
  }

  private get slot(): TabSlot {
    return this.tabs.focused();
  }

  private get tree(): SnapNode[] {
    return this.slot.tree ?? [];
  }

  private get byRef(): Map<string, SnapNode> {
    return this.slot.byRef;
  }

  private get pageState(): PageState | undefined {
    return this.slot.pageState;
  }

  private set pageState(v: PageState | undefined) {
    this.slot.pageState = v;
  }

  private async refresh(): Promise<void> {
    const s = this.slot;
    s.tree = await collectAxTree(s.session);
    s.byRef.clear();
    for (const n of s.tree) s.byRef.set(n.ref, n);
  }

  private node(ref: string): SnapNode {
    const key = ref.startsWith("@") ? ref : `@${ref}`;
    const n = this.byRef.get(key);
    if (!n) throw new UnaError("stale_ref", `ref ${ref} not in current snapshot`, "re-run: una snap");
    return n;
  }

  async exec(cmd: Command): Promise<unknown> {
    switch (cmd.verb) {
      case "vault": {
        if (!this.vault) throw new UnaError("invalid", "vault requires a running daemon; start una serve");
        if (cmd.action === "status") return { unlocked: await this.vault.isUnlocked() };
        if (cmd.action === "list") return await this.vault.list();
        await this.assertResolved();
        if (!await this.vault.isUnlocked()) {
          const ui = this.vaultUiUrl?.();
          throw new UnaError("invalid", "vault is locked", ui
            ? `the human must unlock it first in their own browser: open ${ui} (MCP vault_open / CLI 'una vault ui'), then retry`
            : "the human must unlock the vault first — MCP vault_open or CLI 'una vault ui' prints the link");
        }
        const current = (await this.session.current()).url;
        let origin: string;
        try { origin = normalizeOrigin(current); }
        catch { throw new UnaError("invalid", "vault fill requires an HTTPS page"); }
        const accounts = (await this.vault.list()).filter((entry) => matchesOrigin(entry.website, current));
        if (!accounts.length) throw new UnaError("not_found", "no vault account matches this exact HTTPS origin");
        const account = cmd.accountId ? accounts.find((entry) => entry.id === cmd.accountId) : accounts.length === 1 ? accounts[0] : undefined;
        if (!account) throw new UnaError("invalid", "multiple accounts or unknown account id; choose a vault list account id");
        let fields: { stage: "username" | "password" | "both"; usernameId?: number; passwordId?: number };
        try { fields = await locateLoginForm(this.session); }
        catch { throw new UnaError("invalid", "login form is missing, changed, or ambiguous"); }
        if (!matchesOrigin(origin, (await this.session.current()).url)) throw new UnaError("invalid", "page origin changed; fill aborted");
        const credential = await this.vault.get(account.id);
        if (fields.usernameId !== undefined) {
          await clearValue(this.session, fields.usernameId);
          await focusAndGetCurrent(this.session, fields.usernameId);
          if (!matchesOrigin(origin, (await this.session.current()).url)) throw new UnaError("invalid", "page origin changed; fill aborted");
          await insertText(this.session, credential.username);
        }
        if (fields.passwordId !== undefined) {
          if (!matchesOrigin(origin, (await this.session.current()).url)) throw new UnaError("invalid", "page origin changed; fill aborted");
          // A username input may trigger a staged transition: never reuse a previously found password node.
          if (fields.stage === "both") {
            const fresh = await locateLoginForm(this.session);
            if (fresh.stage !== "both" || fresh.passwordId !== fields.passwordId) throw new UnaError("invalid", "login form changed; fill aborted");
          }
          await clearValue(this.session, fields.passwordId);
          await focusAndGetCurrent(this.session, fields.passwordId);
          if (!matchesOrigin(origin, (await this.session.current()).url)) throw new UnaError("invalid", "page origin changed; fill aborted");
          await insertText(this.session, credential.password);
        }
        return { filled: true, stage: fields.stage, origin, accountId: account.id };
      }
      case "open":
        await this.session.navigate(cmd.url);
        await this.waitForLoad();
        this.pageState = await detectState(this.session);
        {
          const cur = await this.session.current();
          return { ...cur, state: this.pageState.state, kind: this.pageState.kind };
        }
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
        await this.assertResolved();
        const n = this.node(cmd.ref);
        await clickAt(this.session, n.backendNodeId);
        return { ok: true, clicked: n.ref };
      }
      case "type": {
        await this.assertResolved();
        const n = this.node(cmd.ref);
        await focusAndGetCurrent(this.session, n.backendNodeId);
        await insertText(this.session, cmd.text);
        return { ok: true, typed: cmd.text.length };
      }
      case "fill": {
        await this.assertResolved();
        const n = this.node(cmd.ref);
        await clearValue(this.session, n.backendNodeId);
        await focusAndGetCurrent(this.session, n.backendNodeId);
        await insertText(this.session, cmd.text);
        return { ok: true, filled: cmd.text.length };
      }
      case "select": {
        await this.assertResolved();
        const n = this.node(cmd.ref);
        await selectOption(this.session, n.backendNodeId, cmd.value);
        return { ok: true, selected: cmd.value };
      }
      case "attach": {
        await this.assertResolved();
        const res = cmd.ref ? await this.attachViaRef(cmd.file, cmd.ref) : await this.attach(cmd.file);
        return { ok: true, file: cmd.file, ...res };
      }
      case "press": {
        await this.assertResolved();
        if (cmd.ref) {
          const n = this.node(cmd.ref);
          await focusAndGetCurrent(this.session, n.backendNodeId);
        }
        await pressKey(this.session, cmd.key);
        return { ok: true, key: cmd.key, ref: cmd.ref ?? null };
      }
      case "eval": {
        await this.assertResolved();
        if (cmd.ref) {
          const n = this.node(cmd.ref);
          return { value: await evalOn(this.session, n.backendNodeId, `function(){ return (${cmd.expr}); }`) };
        }
        const res = await this.session.client.send("Runtime.evaluate", { expression: cmd.expr, returnByValue: true });
        if (res.exceptionDetails) throw new UnaError("cdp", `eval error: ${JSON.stringify(res.exceptionDetails)}`);
        return { value: (res.result as { value?: unknown }).value ?? null };
      }
      case "scroll":
        await this.assertResolved();
        await this.scroll(cmd.dir, cmd.px);
        return { ok: true, dir: cmd.dir, px: cmd.px };
      case "wait":
        if (cmd.target === "resolve") return this.waitResolve(cmd.timeout);
        await this.wait(cmd.target);
        return { waited: cmd.target };
      case "get": {
        await this.assertResolved();
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
      case "fuse": {
        const { runFuse } = await import("../fuse/run");
        return runFuse(this.session, this.byRef, cmd.cmds);
      }
      case "skill":
        return this.skill();
      case "serve":
        throw new UnaError("grammar", "serve is daemon-only", "call: una serve");
      case "tab": {
        const slot = await this.tabs.create(cmd.url);
        await this.waitForLoad();
        const cur = await slot.session.current();
        return { index: slot.index, ...cur, state: slot.pageState?.state ?? "loaded", tabs: this.tabs.count() };
      }
      case "tabs":
        return { tabs: await this.tabs.all() };
      case "switch": {
        const slot = await this.tabs.switch(cmd.target);
        const cur = await slot.session.current();
        return { index: slot.index, ...cur, active: true };
      }
      case "close": {
        await this.tabs.close(cmd.index);
        return { ok: true, closed: cmd.index, tabs: this.tabs.count() };
      }
      case "parallel":
        return this.parallelJobs(cmd.jobs);
    }
  }

  async parallelJobs(jobs: ParallelJob[]): Promise<unknown> {
    const { runParallel } = await import("../parallel/tabs");
    return runParallel(this.tabs, jobs);
  }

  private async waitForLoad(): Promise<void> {
    // Bounded readyState poll instead of a blind delay: returns as soon as the
    // page stops loading (and never blocks slow loads longer than 5s).
    const deadline = Date.now() + 5_000;
    for (;;) {
      try {
        const res = await this.session.client.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
        if ((res.result as { value?: string }).value !== "loading") return;
      } catch { /* context resetting mid-navigation: keep polling until the deadline */ }
      if (Date.now() > deadline) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  private async assertResolved(): Promise<void> {
    this.pageState = await detectState(this.session);
    if (this.pageState.state !== "loaded") {
      this.slot.byRef.clear();
      this.slot.tree = [];
      throw new UnaError("challenge", `page is ${this.pageState.state} (${this.pageState.kind ?? "unknown"})`, "run: una wait resolve, or re-launch with --mode headed|attach");
    }
  }

  private async waitResolve(timeout = 10_000): Promise<PageState & { outcome: "resolved" | "blocked" | "timed_out" }> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const st = await detectState(this.session);
      this.pageState = st;
      if (st.state === "loaded") {
        return { ...st, outcome: "resolved" };
      }
      this.slot.byRef.clear();
      this.slot.tree = [];
      if (st.state === "blocked") return { ...st, outcome: "blocked" };
      if (Date.now() >= deadline) {
        return { ...st, outcome: "timed_out" };
      }
      await new Promise((r) => setTimeout(r, Math.min(300, Math.max(0, deadline - Date.now()))));
    }
  }

  private async attach(file: string): Promise<{ input: string; len: number }> {
    const { existsSync, realpathSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { homedir } = await import("node:os");
    const expanded = file.startsWith("~/") ? resolve(homedir(), file.slice(2)) : resolve(file);
    if (!existsSync(expanded)) {
      throw new UnaError("attach", `file not found: ${file}`, `resolved to ${expanded}`);
    }
    const abs = realpathSync(expanded);

    // locate the file input via DOM.getDocument + querySelector
    const doc = await this.session.client.send("DOM.getDocument", { depth: -1, pierce: true });
    const rootNode = (doc.root ?? { nodeId: 0 }) as { nodeId: number };
    const q = await this.session.client.send("DOM.querySelector", { nodeId: rootNode.nodeId, selector: 'input[type="file"]:not([disabled])' });
    if (!q.nodeId) {
      throw new UnaError("attach", "no file input on page", "open a page that exposes an <input type=file>");
    }

    // set files (CDP sanctioned path; bypasses JS security on FileList)
    await this.session.client.send("DOM.setFileInputFiles", { nodeId: q.nodeId as number, files: [abs] });

    // verify the input actually accepted the file
    const v = await this.session.client.send("Runtime.evaluate", {
      expression: `(() => { const i = document.querySelector('input[type="file"]'); return { len: i?.files?.length ?? 0, name: i?.files?.[0]?.name ?? null }; })()`,
      returnByValue: true,
    });
    const val = (v.result as { value?: { len: number; name: string | null } }).value ?? { len: 0, name: null };
    if (val.len === 0) {
      throw new UnaError("attach", "page rejected the file (files.length=0)", "site may require a real drag-drop or interactive chooser");
    }
    return { input: val.name ?? "", len: val.len };
  }

  private async attachViaRef(file: string, ref: string): Promise<{ input: string; len: number; via: "chooser" }> {
    const { existsSync, realpathSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { homedir } = await import("node:os");
    const expanded = file.startsWith("~/") ? resolve(homedir(), file.slice(2)) : resolve(file);
    if (!existsSync(expanded)) {
      throw new UnaError("attach", `file not found: ${file}`, `resolved to ${expanded}`);
    }
    const abs = realpathSync(expanded);
    await this.assertResolved();

    // intercept the native file chooser, real-click the target (e.g. "Attach files")
    await this.session.client.send("Page.setInterceptFileChooserDialog", { enabled: true });
    const n = this.node(ref);
    const chooserPromise: Promise<number> = new Promise((resolveChooser, reject) => {
      const off = this.session.client.on("Page.fileChooserOpened", (p) => {
        off();
        const id = Number((p.backendNodeId as number) ?? 0);
        resolveChooser(id);
      });
      setTimeout(() => {
        off();
        reject(new UnaError("attach", "file chooser did not open", "the target ref may not open a file picker"));
      }, 8000);
    });

    try {
      await clickAt(this.session, n.backendNodeId);
      const backendNodeId = await chooserPromise;
      if (!backendNodeId) throw new UnaError("attach", "chooser returned no node", "retry or the control changed");
      await this.session.client.send("DOM.setFileInputFiles", { backendNodeId, files: [abs] });
    } finally {
      await this.session.client.send("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
    }

    // give the site a beat to surface the chip, then verify
    await new Promise((r) => setTimeout(r, 800));
    const v = await this.session.client.send("Runtime.evaluate", {
      expression: `(() => { const i = document.querySelector('input[type="file"]'); return { len: i?.files?.length ?? 0, name: i?.files?.[0]?.name ?? null }; })()`,
      returnByValue: true,
    });
    const val = (v.result as { value?: { len: number; name: string | null } }).value ?? { len: 0, name: null };
    return { input: val.name ?? "", len: val.len, via: "chooser" };
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
      // readyState covers the "already loaded" case without events leaking past attach
      const deadline = Date.now() + 10_000;
      for (;;) {
        try {
          const res = await this.session.client.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
          if ((res.result as { value?: string }).value === "complete") return;
        } catch { /* navigating: keep polling */ }
        if (Date.now() > deadline) return;
        await new Promise((r) => setTimeout(r, 100));
      }
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
