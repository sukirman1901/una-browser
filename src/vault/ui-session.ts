import { randomBytes, timingSafeEqual } from "node:crypto";

const IDLE_MS = 15 * 60 * 1000;
export type UiSession = { csrf: string; authenticated: boolean; generation: number; lastUsed: number };

function secret(): string { return randomBytes(32).toString("base64url"); }

export class UiSessions {
  private readonly sessions = new Map<string, UiSession>();

  create(authenticated = false, generation = -1): { id: string; csrf: string } {
    const id = secret();
    const csrf = secret();
    this.sessions.set(id, { csrf, authenticated, generation, lastUsed: Date.now() });
    return { id, csrf };
  }

  get(id: string | undefined): UiSession | undefined {
    if (!id) return;
    const session = this.sessions.get(id);
    if (session && Date.now() - session.lastUsed >= IDLE_MS) {
      this.sessions.delete(id);
      return;
    }
    if (session) session.lastUsed = Date.now();
    return session;
  }

  matches(session: UiSession | undefined, token: string | undefined): boolean {
    if (!session || !token) return false;
    const a = Buffer.from(session.csrf);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  remove(id: string | undefined): void { if (id) this.sessions.delete(id); }
  clear(): void { this.sessions.clear(); }
}
