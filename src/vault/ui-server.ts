import type { Server } from "bun";
import type { VaultManager } from "./manager";
import { UiSessions } from "./ui-session";

const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'",
  "X-Frame-Options": "DENY",
};
const MAX_BODY = 16 * 1024;

function cookie(id: string): string {
  return `una_vault_ui=${id}; Path=/; HttpOnly; SameSite=Strict`;
}

function response(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", ...extra } });
}

function sessionId(req: Request): string | undefined {
  return req.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("una_vault_ui="))?.slice("una_vault_ui=".length);
}

export function startVaultUi(vault: VaultManager): { http: Server<undefined>; url: string; close: () => Promise<void> } {
  const sessions = new UiSessions();
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      // Compare the actual Host header, not a URL reconstructed by the server.
      const origin = `http://127.0.0.1:${http.port}`;
      if (req.headers.get("host") !== `127.0.0.1:${http.port}`) return response("Forbidden", 403);
      const path = new URL(req.url).pathname;
      if (req.method === "GET" && path === "/") {
        let id = sessionId(req);
        let session = sessions.get(id);
        let setCookie: Record<string, string> = {};
        if (!session) {
          const created = sessions.create();
          id = created.id;
          session = sessions.get(id)!;
          setCookie = { "Set-Cookie": cookie(id) };
        }
        const action = vault.isUnlocked() && session!.authenticated ? "add" : "unlock";
        return response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Una Vault</title></head><body><main><h1>Una Vault</h1><form method="post" action="/vault/${action}"><input type="hidden" name="csrf" value="${session!.csrf}"><label for="passphrase">Master passphrase</label><input id="passphrase" name="passphrase" type="password" required><button type="submit">Unlock</button></form></main></body></html>`, 200, setCookie);
      }
      if (req.method !== "POST") return response("Not found", 404);
      if (req.headers.get("origin") !== origin) return response("Forbidden", 403);
      if (path !== "/vault/unlock" && path !== "/vault/add") return response("Not found", 404);
      if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") return response("Unsupported media type", 415);
      if (Number(req.headers.get("content-length")) > MAX_BODY) return response("Request too large", 413);
      const raw = await req.text();
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY) return response("Request too large", 413);
      const form = new URLSearchParams(raw);
      const id = sessionId(req);
      const session = sessions.get(id);
      if (!sessions.matches(session, form.get("csrf") ?? undefined)) return response("Forbidden", 403);
      if (path !== "/vault/unlock" || session!.authenticated) return response("Forbidden", 403);
      const passphrase = form.get("passphrase") ?? "";
      if (!passphrase) return response("Invalid passphrase", 400);
      try {
        vault.unlock(passphrase);
      } catch {
        return response("Unable to unlock vault. Check the passphrase and try again.", 401);
      }
      sessions.remove(id);
      const authenticated = sessions.create(true);
      return response("", 303, { Location: "/", "Set-Cookie": cookie(authenticated.id) });
    },
  });
  return {
    http,
    url: `http://127.0.0.1:${http.port}/`,
    async close() { sessions.clear(); vault.lock(); await http.stop(); },
  };
}
