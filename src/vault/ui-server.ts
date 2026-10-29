import type { Server } from "bun";
import type { VaultManager } from "./manager";
import { UiSessions } from "./ui-session";
import { renderError, renderVaultPage } from "./ui-routes";
import { canonicalWebsite } from "./store";
const css = Bun.file(new URL("./ui.css", import.meta.url));
const client = Bun.file(new URL("./ui-client.js", import.meta.url));

const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'self'; script-src 'self'",
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
      const requestUrl = new URL(req.url);
      if (requestUrl.search) return response("Not found", 404);
      const path = requestUrl.pathname;
      if (req.method === "GET" && path === "/vault.css") return response(await css.text(), 200, { "Content-Type": "text/css; charset=utf-8" });
      if (req.method === "GET" && path === "/vault.js") return response(await client.text(), 200, { "Content-Type": "text/javascript; charset=utf-8" });
      if (req.method === "GET" && (path === "/" || /^\/vault\/(edit|delete)\/[0-9a-f-]{36}$/.test(path))) {
        let id = sessionId(req);
        let session = sessions.get(id);
        let setCookie: Record<string, string> = {};
        if (session?.authenticated && (!vault.isUnlocked() || session.generation !== vault.getGeneration())) {
          sessions.remove(id);
          session = undefined;
        }
        if (!session) {
          const created = sessions.create();
          id = created.id;
          session = sessions.get(id)!;
          setCookie = { "Set-Cookie": cookie(id) };
        }
        return response(renderVaultPage(vault, session!.csrf, session!.authenticated && vault.isUnlocked(), path), 200, setCookie);
      }
      if (req.method !== "POST") return response("Not found", 404);
      if (req.headers.get("origin") !== origin) return response("Forbidden", 403);
      if (!/^\/vault\/(unlock|init|add|lock|(?:edit|delete)\/[0-9a-f-]{36})$/.test(path)) return response("Not found", 404);
      if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") return response("Unsupported media type", 415);
      if (Number(req.headers.get("content-length")) > MAX_BODY) return response("Request too large", 413);
      const raw = await req.text();
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY) return response("Request too large", 413);
      const form = new URLSearchParams(raw);
      const id = sessionId(req);
      const session = sessions.get(id);
      if (!sessions.matches(session, form.get("csrf") ?? undefined)) return response("Forbidden", 403);
      const allowed = path === "/vault/init" ? ["csrf", "passphrase", "confirm"]
        : path === "/vault/unlock" ? ["csrf", "passphrase"]
        : path === "/vault/lock" ? ["csrf"]
        : path.startsWith("/vault/delete/") ? ["csrf", "confirm"]
        : ["csrf", "website", "username", "password", "notes"];
      if ([...form.keys()].some((key) => !allowed.includes(key) || form.getAll(key).length !== 1)) return response("Invalid form", 400);
      const auth = session!.authenticated && vault.isUnlocked() && session!.generation === vault.getGeneration();
      const redirect = (renew = false) => {
        if (!renew) return response("", 303, { Location: "/" });
        sessions.remove(id);
        const next = sessions.create(true, vault.getGeneration());
        return response("", 303, { Location: "/", "Set-Cookie": cookie(next.id) });
      };
      if (path === "/vault/init" || path === "/vault/unlock") {
        if (session!.authenticated || (path === "/vault/init" ? vault.exists() : !vault.exists())) return response("Forbidden", 403);
        const passphrase = form.get("passphrase") ?? "";
        if (!passphrase || (path === "/vault/init" && passphrase !== form.get("confirm"))) return response(renderError("Passphrases must match and cannot be empty."), 400);
        try {
          if (path === "/vault/init") vault.init(passphrase);
          else vault.unlock(passphrase);
        } catch {
          return response(path === "/vault/unlock"
            ? renderVaultPage(vault, session!.csrf, false, "/", true)
            : renderError("Unable to open vault. Check the passphrase and try again."), 401);
        }
        return redirect(true);
      }
      if (!auth) return response("Forbidden", 403);
      if (path === "/vault/lock") {
        vault.lock();
        sessions.clear();
        const next = sessions.create();
        return response("", 303, { Location: "/", "Set-Cookie": cookie(next.id) });
      }
      const match = /^\/vault\/(edit|delete)\/([0-9a-f-]{36})$/.exec(path);
      if (match?.[1] === "delete") {
        if (form.get("confirm") !== "yes") return response(renderError("Confirm deletion before continuing."), 400);
        try { vault.delete(match[2]!); } catch { return response(renderError("Login not found."), 404); }
        return redirect();
      }
      const website = form.get("website") ?? "";
      const username = form.get("username") ?? "";
      const password = form.get("password") ?? "";
      const notes = form.get("notes") ?? "";
      if (!username || !password) return response(renderError("Website, username and password are required."), 400);
      try { canonicalWebsite(website); } catch { return response(renderError("Enter a valid HTTPS website."), 400); }
      try {
        const credential = { website, username, password, notes };
        if (match?.[1] === "edit") vault.edit(match[2]!, credential);
        else vault.add(credential);
      } catch {
        return response(renderError("This login already exists or could not be saved."), 409);
      }
      return redirect();
    },
  });
  return {
    http,
    url: `http://127.0.0.1:${http.port}/`,
    async close() { sessions.clear(); vault.lock(); await http.stop(); },
  };
}
