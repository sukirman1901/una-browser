# Vault Local UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace terminal-only vault onboarding and management with a clean, accessible local page opened from OpenCode, without sending secrets through MCP or the una-controlled browser.

**Architecture:** Run a separate loopback-only HTTP listener for the vault UI in the existing Bun daemon. UI POSTs call the same `VaultManager` but require an independent human browser session, CSRF protection, and Origin/Host validation; una's automation port still cannot manage secrets. OpenCode offers a URL-mode MCP elicitation where supported and a nonsecret link fallback otherwise. Keep encrypted vault storage and CLI unchanged.

**Tech Stack:** Bun/TypeScript, native `Bun.serve`, existing `VaultManager` and MCP stdio server, server-rendered HTML/CSS with a minimal local script only if necessary, `bun:test`, una/CDP for synthetic local UI tests. No Playwright/Puppeteer, cloud service, external fonts, external JS, or new UI framework.

**Design:** `docs/plans/2026-10-28-vault-local-ui-design.md`. Apply @frontend-expert (responsive/a11y/forms/quality gates), @anything-good in DURING mode, @test-driven-development, and @verification-before-completion. Do not restart or navigate the user's active Instagram daemon during development. Use temporary `UNA_ROOT`, separate random ports, and synthetic secrets.

---

### Task 1: Isolated local UI transport and browser session

**Files:** Create `src/vault/ui-session.ts`, `src/vault/ui-server.ts`, `test/vault-ui-security.test.ts`; modify `src/serve.ts:16-95`.

1. Write tests that start a synthetic daemon and prove the UI listener binds `127.0.0.1` on its own ephemeral port; the automation port refuses UI POST routes; UI rejects wrong `Host`, wrong `Origin`, cross-origin POST, unknown content type, oversized body, missing/mismatched CSRF, and missing session. Assert `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, a restrictive CSP, no CORS wildcard, HttpOnly+SameSite=Strict cookies, and no bearer token in URL. Example assertion: `expect((await fetch(uiUrl + '/vault/add', {method:'POST', body:'...'})).status).toBe(403)`.
2. Run `bun test test/vault-ui-security.test.ts`; expect a failure because the UI server does not exist.
3. Implement a separate `Bun.serve({ hostname:'127.0.0.1', port:0 })`, request-size limits, exact loopback Host validation, Origin checks for mutating requests, strict HTML escaping, opaque random session IDs kept only in daemon memory, pre-auth CSRF cookie/token for init/unlock, and rotated authenticated session+CSRF cookie/token after unlock. Reject una automation API cookies and prevent API routes from reaching UI handlers. UI sessions expire after a short idle interval (document exact duration), end on lock/daemon stop, and do not unlock without the passphrase.
4. Run `bun test test/vault-ui-security.test.ts` and `bunx tsc --noEmit`; expect green. Commit `feat(vault): isolate local UI and protect sessions`.

### Task 2: Vault workflows and safe server-side rendering

**Files:** Create `src/vault/ui-routes.ts`, `test/vault-ui-flow.test.ts`; modify `src/vault/ui-server.ts`, `src/vault/manager.ts` only where existing methods are insufficient.

1. Write failing tests for new vault setup with master confirmation; unlock existing vault; add, edit, delete (with explicit confirmation), list and lock. Reuse existing encrypted vault file without migration; assert every response/redirect/URL is free of passphrases, passwords, and notes, and edit never pre-populates a saved password. Test wrong passphrase, duplicate account, non-HTTPS website, expired session, repeated POST, and no partial write. Tests must never inspect the user's real `~/.una`.
2. Run `bun test test/vault-ui-flow.test.ts`; expect fail for missing UI routes.
3. Implement server-rendered pages and POST/redirect/GET handlers. Keep all secret inputs in POST bodies; never echo values in errors, logs, query strings, hidden fields, or MCP results. Render only metadata (origin, username/account label) after authentication. Use safe, targeted error messages; never return a saved password or saved notes to the browser DOM. Mark all responses `no-store`. Only an authenticated explicit lock invalidates UI sessions and locks the manager. Do not delete or modify existing vault data on failed requests.
4. Run `bun test test/vault-ui-flow.test.ts test/vault-store.test.ts` and `bunx tsc --noEmit`; expect pass. Commit `feat(vault): manage credentials through local UI`.

### Task 3: Minimal responsive UI and accessibility

**Files:** Create `src/vault/ui.css`, `src/vault/ui-client.js` only if a password visibility toggle cannot be achieved without JS, `test/vault-ui-a11y.test.ts`; modify `src/vault/ui-routes.ts`; update `README.md` with a short UI screenshot/usage description, no credential samples.

1. Test accessibility and states: visible labels, required fields, error `role=alert`, status announcement, focus order and visible focus, keyboard show/hide password, cancel/delete confirmation, non-empty disabled/loading state on submit, and `prefers-color-scheme` light/dark. Check layouts at 320/768/1024/1440 CSS pixels, zoom, and reduced motion using una with synthetic local credentials. Start with a failing assertion (for example a missing associated label) and run `bun test test/vault-ui-a11y.test.ts` red.
2. Implement one narrow-column page with neutral system font/color tokens, theme from OS, a single primary CTA, restrained secondary controls, plain-language copy and no hero/gradient/card grid/external asset. Use semantic forms, real buttons and focus rings; password visibility is off by default. Ensure every UI control has behavior and empty/loading/error/success states are intentional.
3. Run `bun test test/vault-ui-a11y.test.ts`, `bunx tsc --noEmit`; inspect screenshots via una and record @frontend-expert responsive/a11y gates and @anything-good L1→L2→L3 evidence. Commit `feat(vault): ship accessible minimal UI`.

### Task 4: OpenCode entry point and URL elicitation

**Files:** Modify `src/mcp/server.ts:19-124`, `src/serve.ts`, `test/mcp.test.ts`; create `test/vault-ui-mcp.test.ts`.

1. Write failing tests for `vault_open` returning only a loopback UI URL (no secret/capability in URL or MCP text). For a client advertising URL elicitation, test URL-mode flow or `URLElicitationRequiredError` contract and cancel behavior as supported by OpenCode V2; for unsupported clients, test a plain address fallback. Assert that form-mode elicitation is NEVER used for master passphrase, password, or recovery code. Verify MCP does not expose UI POST or management operations as tool arguments.
2. Run `bun test test/mcp.test.ts test/vault-ui-mcp.test.ts`; expect red. Before choosing wire shape, check the real OpenCode V2 MCP client capability/URL-mode behavior using a synthetic local fixture, then implement the smallest supported protocol path in the existing stdio server. URL does not contain a one-time auth token. Do not auto-open the URL with una/CDP; human opens it in a normal browser.
3. Run the MCP tests and `bunx tsc --noEmit`; expect pass. Commit `feat(vault): open out-of-band UI from OpenCode`.

### Task 5: Lifecycle safety and stale socket recovery

**Files:** Modify `src/vault/ipc.ts`, `src/serve.ts`; create `test/vault-restart.test.ts`.

1. Test a stopped daemon leaves no usable UI session; graceful shutdown closes both listeners and zeroes the key. Reproduce the already observed SIGTERM stale Unix socket: new startup must recover only a verified stale socket of the expected type/owner/path while refusing to remove a socket held by an active daemon. A failed UI or socket startup must close launched Chrome and release resources. Run `bun test test/vault-restart.test.ts` and observe red.
2. Implement explicit lifecycle cleanup and conservative stale socket handling with no broad unlink or recursive deletion; guard against concurrent start and preserve unrelated files. Run `bun test test/vault-restart.test.ts test/serve.test.ts` and `bunx tsc --noEmit`; expect pass. Commit `fix(vault): make UI and socket lifecycle safe`.

### Task 6: Documentation, security review, integration verification

**Files:** Modify `README.md`, `AGENTS.md`, `src/skills/core.md`; create `test/vault-ui-e2e.test.ts`.

1. Write a local-only E2E test: MCP `vault_open` → ordinary-browser-style una fixture with synthetic data → unlock/add → `vault_fill` on a separate synthetic HTTPS site. Ensure the resulting MCP output, query strings and UI HTML never include the synthetic secret. Run the test red before making any missing integration changes.
2. Document link flow and CLI fallback for Windows/macOS/Linux, the new UI address lifetime, password rotation guidance, safe backup, and explicit residual same-OS-user/CDP threat boundary. State that the current headed Instagram browser/session must not be used to enter real vault secrets. Resolve any red E2E test minimally.
3. Run `bun test`, `bunx tsc --noEmit`, `git diff --check`, and offline secret/static scans scoped to changed files. Manually inspect no real credential reads, file permissions, Origin/Host/CSRF/session checks, HTML escaping, shutdown behavior, and UI controls. Report @frontend-expert responsive/accessible conventions and @anything-good Delivery Gate with evidence; if a gate fails, fix and re-run before claiming completion. Commit `docs(vault): verify cross-platform local UI`.

## Handoff and safety

Work in an ignored `.worktrees/` feature branch; the current `main` includes a committed design and may be ahead of `origin/main`. Do not automatically merge or restart the active user daemon/browser during implementation. Get user confirmation before replacing the running service. No real Instagram, personal password, or master passphrase in tests, browser snapshots, shell arguments, or logs.
