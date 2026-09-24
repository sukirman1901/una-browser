import { PageSession } from "./cdp/session";
import { cdpNewTab } from "./cdp/http";
import { UnaError } from "./errors";
import { detectState, type PageState } from "./state/detect";
import type { SnapNode } from "./view/snap";

export interface TabSlot {
  id: string;
  session: PageSession;
  index: number;
  tree: SnapNode[] | null;
  byRef: Map<string, SnapNode>;
  pageState?: PageState;
}

export interface TabSummary {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

export interface CreateOpts {
  ephemeral?: boolean;
}

export function firstSlot(session: PageSession): TabSlot {
  return { id: session.targetId, session, index: 0, tree: null, byRef: new Map() };
}

export class TabManager {
  private slots: TabSlot[] = [];
  private focus = 0;

  constructor(private chromePort: number, initial: TabSlot) {
    if (initial.index !== 0) initial.index = 0;
    this.slots = [initial];
  }

  focused(): TabSlot {
    return this.slots[this.focus] ?? this.slots[0];
  }

  count(): number {
    return this.slots.length;
  }

  async all(): Promise<TabSummary[]> {
    const out: TabSummary[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const cur = await s.session.current().catch(() => ({ url: "", title: "" }));
      out.push({ index: i, url: cur.url, title: cur.title, active: i === this.focus });
    }
    return out;
  }

  slotAt(index: number): TabSlot {
    const s = this.slots[index];
    if (!s) throw new UnaError("not_found", `no tab at index ${index}`, `run: una tabs`);
    return s;
  }

  indexOf(targetId: string): number {
    return this.slots.findIndex((s) => s.id === targetId);
  }

  async create(url: string, opts: CreateOpts = {}): Promise<TabSlot> {
    if (this.chromePort <= 0) {
      throw new UnaError("invalid", "tab/parallel need the daemon Chrome", "start with: una serve");
    }
    const tab = await cdpNewTab(this.chromePort, url);
    const session = await PageSession.connectTarget(tab.webSocketDebuggerUrl, tab.id);
    const slot: TabSlot = {
      id: tab.id,
      session,
      index: opts.ephemeral ? -1 : this.slots.length,
      tree: null,
      byRef: new Map(),
    };
    await new Promise((r) => setTimeout(r, 200));
    if (!opts.ephemeral) {
      this.slots.push(slot);
      this.focus = this.slots.length - 1;
      slot.pageState = await detectState(session).catch(() => undefined);
    }
    return slot;
  }

  async switch(target: number | string): Promise<TabSlot> {
    let idx: number;
    if (typeof target === "number") {
      idx = target;
    } else if (/^\d+$/.test(target)) {
      idx = Number(target);
    } else {
      const matches: number[] = [];
      for (let i = 0; i < this.slots.length; i++) {
        const cur = await this.slots[i].session.current().catch(() => ({ url: "", title: "" }));
        if (cur.url.toLowerCase().includes(target.toLowerCase())) matches.push(i);
      }
      if (matches.length !== 1) {
        throw new UnaError("not_found", `switch '${target}' matched ${matches.length} tabs`, `run: una tabs`);
      }
      idx = matches[0];
    }
    const slot = this.slotAt(idx);
    this.focus = idx;
    return slot;
  }

  async close(index: number): Promise<void> {
    const slot = this.slotAt(index);
    await slot.session.closeTab().catch(() => {});
    this.slots.splice(index, 1);
    this.slots.forEach((s, i) => { s.index = i; });
    if (this.slots.length === 0) throw new UnaError("not_found", "no tabs left after close", "run: una tab <url>");
    if (index < this.focus) this.focus--;
    else if (index === this.focus) this.focus = Math.min(this.focus, this.slots.length - 1);
  }

  async closeSlot(slot: TabSlot): Promise<void> {
    const i = this.slots.indexOf(slot);
    if (i >= 0) return this.close(i);
    await slot.session.closeTab().catch(() => {});
  }
}