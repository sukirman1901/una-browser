# Local Credential Vault Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store site logins in a locally encrypted vault, unlocked interactively once per daemon session, and fill a matching login form on explicit request without emitting credentials in command output.

**Architecture:** Add an encrypted, versioned vault file and daemon-owned unlocked state. An OS-permissioned local Unix socket handles interactive CLI management; existing HTTP/MCP expose only nonsecret status, list, and fill. Fill verifies the focused page's HTTPS hostname and form before inserting values through CDP, without submitting.

**Tech Stack:** Bun/TypeScript, node:crypto (scrypt + AES-256-GCM), node:net Unix sockets, node:fs atomic writes, existing CDP client, bun:test. No Playwright/Puppeteer. Refer to `docs/plans/2026-10-28-local-credential-vault-design.md` for security boundary and limitations.

---

### Task 1: Crypto and durable storage

**Files:** Create `src/vault/crypto.ts`, `src/vault/store.ts`, `test/vault-store.test.ts`; inspect `src/identity.ts`, `test/identity.test.ts`.

1. Write failing tests with temporary `UNA_ROOT`: create and reopen a record with website, username/email, password, notes; reject wrong passphrase, altered ciphertext/tag, duplicate account, corrupt version; assert file mode 0600 and directory 0700; assert atomic update preserves old file on failure.
2. Run `bun test test/vault-store.test.ts` (expect fail before implementation).
3. Implement a versioned JSON vault with random per-vault salt, `scrypt` KDF with fixed documented limits, random 12-byte AES-256-GCM nonce per record, and AAD binding version + canonical hostname + entry id. Keep all credentials including notes encrypted. Define the vault verification record without an unencrypted password verifier. Use a private `~/.una/vault` directory with restrictive permissions and atomic temp-file + rename writes. Reject symlinks and incompatible versions; do not log plaintext or echo secrets in errors.
4. Run `bun test test/vault-store.test.ts` and `bunx tsc --noEmit` (expect pass). Commit `feat(vault): add encrypted local store`.

### Task 2: Local private management channel and TTY input

**Files:** Create `src/vault/manager.ts`, `src/vault/ipc.ts`, `src/vault/prompt.ts`, `test/vault-ipc.test.ts`; modify `src/serve.ts`, `bin/una.ts`, `src/args.ts`, `test/args.test.ts`, `test/serve.test.ts`.

1. Test local socket mode, private parent-directory permissions, untrusted socket-path/symlink rejection, management commands unavailable over HTTP `/`, and password/passphrase absent from argv, stdout, structured errors, and normal MCP calls. Test lock/restart removes key material; wrong unlock leaves locked state. Run `bun test test/vault-ipc.test.ts test/serve.test.ts` and verify red.
2. Implement daemon-owned vault manager; private socket path under a 0700 directory, socket 0600, verify peer UID where the runtime supports it and otherwise rely on the private directory plus socket permissions (document the OS-user threat boundary). Interactive `una vault init|add|unlock|lock|list|edit|delete` asks for secrets from a TTY with echo disabled; refuse non-TTY secret input and never accept secrets as positional flags, env vars, HTTP body, or MCP args. Ensure prompt echo is restored even on error/interrupt. Forward sensitive operations only over the private socket; `init` must not overwrite existing vault.
3. Run `bun test test/vault-ipc.test.ts test/args.test.ts test/serve.test.ts` and `bunx tsc --noEmit`; commit `feat(vault): add private interactive management`.

### Task 3: Domain policy and form discovery

**Files:** Create `src/vault/match.ts`, `src/vault/form.ts`, `test/vault-match.test.ts`, `test/vault-form.test.ts`; inspect `src/cdp/session.ts`, `src/cdp/dom.ts`, `src/state/detect.ts`.

1. Test that HTTPS exact hostname matches (including host normalization), while HTTP, ports/origins outside policy, suffix attacks (`instagram.com.evil.test`), Unicode lookalikes, parent-domain/subdomain guesses, unsupported form layouts, and multiple matching forms fail closed. Explicitly test allowed form field discovery against a local fixture, including missing/disabled/hidden/password-less inputs. Run tests and verify failure.
2. Implement canonical URL matching with WHATWG URL; decide whether to store exact origin or hostname and keep tests, documentation and fill behavior consistent (recommend exact origin including port). Discover one visible enabled username/email and one password field in same form; do not depend solely on AX snapshot refs (which may omit forms), and recheck page URL immediately before insertion. Do not submit automatically.
3. Run `bun test test/vault-match.test.ts test/vault-form.test.ts`; commit `feat(vault): validate origin and login form`.

### Task 4: Safe fill integration

**Files:** Modify `src/actions/exec.ts`, `src/args.ts`, `src/serve.ts`, `src/cdp/dom.ts`, `test/actions.test.ts`; create `test/vault-fill.test.ts`.

1. Write tests: locked, no match, ambiguous accounts, challenge page, changed URL between check and fill, ambiguous fields return nonsecret errors without inserting any value; successful fill sets both fields and does not submit. Assert no password in `fill` response. Run `bun test test/vault-fill.test.ts` (expect fail).
2. Add `vault status|list|fill [account-id]` read/fill commands in parse/controller/daemon, with `fill` bound to current focused tab and identity. Validate form and origin again immediately before CDP insertion. Return only `{filled:true, origin, accountId}` (no credential lengths or values). Ensure `batch`/`fuse` cannot invoke private management verbs. Explain in docs that existing `eval`, snapshots and DevTools can read a password after fill; this feature does not make the browser an isolation boundary.
3. Run `bun test test/vault-fill.test.ts test/actions.test.ts` and `bunx tsc --noEmit`; commit `feat(vault): fill matching login without submit`.

### Task 5: MCP, documentation, integration and regressions

**Files:** Modify `src/mcp/server.ts`, `README.md`, `AGENTS.md`, `test/mcp.test.ts`; create `test/vault-e2e.test.ts`.

1. Test MCP exposes only status/list/fill, not init/add/unlock/edit/delete or secret fields. Test local login fixture through CLI/daemon/MCP, including multi-account selector and relock. Ensure fixture credentials are synthetic and no test calls Instagram. Run `bun test test/mcp.test.ts test/vault-e2e.test.ts` and verify red.
2. Implement MCP schemas, hide nonsecret account metadata only as intended, document interactive onboarding and unlock, private IPC limits, exact-origin policy, backup/lost-passphrase consequences, and post-fill `eval`/DevTools exposure. Update user-facing una skill output if it lists verbs. Preserve existing browser commands.
3. Run `bun test`, `bunx tsc --noEmit`, and `git diff --check`; inspect output and tests before claiming completion. Commit `docs(vault): document and verify credential workflow`.

## Security review before shipping

Manually inspect whether daemon HTTP binds loopback only, whether any read-only command can leak filled input values, whether the socket has peer authentication and permissions, and whether remote debugging makes the filled password observable. If any item conflicts with the approved design, stop and ask for a revised threat model rather than claiming the vault blocks a malicious harness. Never use production credentials for tests.
