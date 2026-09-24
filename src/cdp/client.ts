import { UnaError } from "../errors.ts";

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
}

export class CdpClient {
  private ws!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  private closed = false;

  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new CdpClient();
      client.ws = ws;
      ws.onopen = () => resolve(client);
      ws.onerror = () => reject(new UnaError("cdp", "WebSocket connect failed", url));
      ws.onmessage = (ev: { data: string | ArrayBuffer | Buffer }) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { id?: number; method?: string; params?: Record<string, unknown> };
          client.handle(msg);
        } catch { /* ignore malformed frame */ }
      };
      ws.onclose = () => {
        client.closed = true;
        for (const { reject, timer } of client.pending.values()) {
          clearTimeout(timer);
          reject(new UnaError("cdp", "connection closed"));
        }
        client.pending.clear();
      };
    });
  }

  private handle(msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: unknown }): void {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        p.reject(new UnaError("cdp", JSON.stringify(msg.error)));
      } else {
        p.resolve((msg as { result?: Record<string, unknown> }).result ?? msg.params ?? {});
      }
      return;
    }
    if (msg.method) {
      const set = this.listeners.get(msg.method);
      if (set) for (const fn of set) fn(msg.params ?? {});
    }
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.closed) throw new UnaError("cdp", "connection closed", "reconnect required");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new UnaError("timeout", `CDP ${method} timed out after 10s`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, fn: (params: Record<string, unknown>) => void): () => void {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method)!.add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }

  close(): void {
    this.closed = true;
    try { this.ws.close(); } catch { /* ignore */ }
  }
}