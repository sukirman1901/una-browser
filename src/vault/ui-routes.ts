import type { VaultManager } from "./manager";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function frame(title: string, body: string): string {
  const status = title === "Create vault" || title === "Unlock vault" ? "Vault locked" : title === "Unable to continue" ? "Action needs attention" : "Vault unlocked";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Una Vault</title><link rel="stylesheet" href="/vault.css"><script src="/vault.js" defer></script></head><body><main><header><h1>Una Vault</h1><p>Manage your saved logins on this device.</p></header><div aria-live="polite" class="status">${status}</div>${body}</main></body></html>`;
}

function hidden(csrf: string): string { return `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`; }
function field(name: string, label: string, type = "text", autocomplete = "off"): string {
  const reveal = type === "password" ? `<button type="button" class="reveal" data-password-toggle="${name}" aria-controls="${name}" aria-pressed="false" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/><path class="eye-slash" d="M3 21 21 3"/></svg></button>` : "";
  return `<div class="field"><label for="${name}">${label}</label><div class="input-row"><input id="${name}" name="${name}" type="${type}"${reveal ? ' class="password-input"' : ""} autocomplete="${autocomplete}" required>${reveal}</div></div>`;
}

export function renderVaultPage(vault: VaultManager, csrf: string, authenticated: boolean, path = "/"): string {
  if (!authenticated) {
    const setup = !vault.exists();
    const name = setup ? "Create vault" : "Unlock vault";
    return frame(name, `<section><h2>${name}</h2><p>${setup ? "Choose a master passphrase to protect your logins." : "Enter your master passphrase to continue."}</p><form method="post" action="/vault/${setup ? "init" : "unlock"}">${hidden(csrf)}${field("passphrase", "Master passphrase", "password", setup ? "new-password" : "current-password")}${setup ? field("confirm", "Confirm passphrase", "password", "new-password") : ""}<button type="submit">${name}</button></form></section>`);
  }
  const entries = vault.list();
  const match = /^\/vault\/(edit|delete)\/([0-9a-f-]{36})$/.exec(path);
  if (match) {
    const entry = entries.find((item) => item.id === match[2]);
    if (!entry) return frame("Not found", "<h2>Login not found</h2><a href=\"/\">Back to vault</a>");
    if (match[1] === "delete") return frame("Delete login", `<section><h2>Delete login?</h2><p>${escapeHtml(entry.website)} · ${escapeHtml(entry.username)}</p><p>This cannot be undone.</p><form action="${path}" method="post">${hidden(csrf)}<input type="hidden" name="confirm" value="yes"><button type="submit">Delete login</button><a href="/">Cancel</a></form></section>`);
    return frame("Edit login", `<section><h2>Edit login</h2><p>Enter a replacement password and notes; saved values are never shown.</p>${loginForm(path, csrf, "Save changes")}</section><a href="/">Cancel</a>`);
  }
  const list = entries.length ? `<ul>${entries.map(({ id, website, username }) => `<li><div><strong>${escapeHtml(website)}</strong><span>${escapeHtml(username)}</span></div><a href="/vault/edit/${id}">Edit</a><a href="/vault/delete/${id}">Delete</a></li>`).join("")}</ul>` : "<p>No logins saved yet.</p>";
  return frame("Your logins", `<section><h2>Saved logins</h2>${list}</section><section><h2>Add login</h2>${loginForm("/vault/add", csrf, "Add login")}</section><form action="/vault/lock" method="post">${hidden(csrf)}<button type="submit">Lock vault</button></form>`);
}

function loginForm(action: string, csrf: string, button: string): string {
  return `<form method="post" action="${action}">${hidden(csrf)}${field("website", "Website (HTTPS)", "url", "url")}${field("username", "Username or email", "text", "username")}${field("password", "Password", "password", "new-password")}<div class="field"><label for="notes">Notes (optional)</label><textarea id="notes" name="notes"></textarea></div><button type="submit">${button}</button></form>`;
}

export function renderError(message: string): string { return frame("Unable to continue", `<div role="alert"><h2>Unable to continue</h2><p>${escapeHtml(message)}</p></div><a href="/">Back to vault</a>`); }
