# Una Vault local UI — design

## User intent and scope

Replace terminal-only vault onboarding and account management with a small, cross-platform local page opened from OpenCode. Keep the existing encrypted vault file, master passphrase, CLI fallback, and explicit `vault_fill`; do not change the secret format or migrate credentials. The first release still requires entering the master passphrase once after a daemon restart, but in the local page instead of a terminal. OS keyrings, cloud sync, automatic password capture, and automatic login are out of scope.

## Alternatives and decision

- **Chosen: local vault UI plus MCP link / URL elicitation.** One interface on Windows, macOS, and Linux, reusing the daemon-owned encrypted vault. Requires careful local HTTP security and avoids making credentials MCP tool arguments.
- Native app per OS offers tighter OS integration but significantly increases maintenance and deployment scope.
- In-band MCP forms are appropriate for nonsecret selections, **not** master passphrases, passwords, or recovery codes. The MCP elicitation specification forbids form mode for sensitive information; URL mode provides an out-of-band interaction.

## Architecture and data flow

1. A new `vault_open` MCP tool gives OpenCode a **public, non-authenticated, non-secret** local URL. If the negotiated MCP client capability supports URL elicitation, request consent to open this URL; otherwise return the address as text for the human to open in their **ordinary browser**. Never navigate the CDP-controlled una browser to the UI as an agent convenience. Do not put a bearer token, passphrase, personal data, or pre-authenticated capability in the URL.
2. A separate vault UI listener binds only to `127.0.0.1`, not to the existing una automation endpoint. The una daemon owns both listeners and the single `VaultManager`. The public landing page contains no credential material. It offers setup, unlock, list, add, edit, delete, and lock actions as state permits. CLI management remains available.
3. Master passphrase and account inputs are sent **only** by POST from the ordinary browser to the local UI, then directly to the daemon's vault manager; they never transit OpenCode tools, the LLM, the una browser's CDP session, URLs, command-line arguments, logs, or UI response bodies. Show account identifiers and origins only after unlock; do not render saved passwords. Notes may be edited via a replacement value, not reflected into an agent-visible response.
4. The UI session is separate from the una automation HTTP API. A pre-authentication CSRF cookie/token pair protects setup and unlock; a successful unlock rotates it into a short-lived, random, HttpOnly, SameSite=Strict authenticated session cookie (path scoped to UI). Mutating requests require this session and its matching CSRF token. On lock or daemon shutdown, invalidate UI sessions and zero the vault key. Check Host and Origin and reject cross-site requests, DNS rebinding, and arbitrary JSON/body shapes. Never expose management routes through the una automation port, `batch`, `fuse`, or MCP tools.
5. Only the ordinary browser is intended for real secrets. The local UI cannot guarantee confidentiality from same-OS-user malware, from a harness controlling the ordinary browser through DevTools, or from a page receiving a vault-filled password. Document this threat boundary prominently. Keep the current Chrome headed Instagram session separate from the UI; do not restart the user's daemon merely to show the page.

## UI design direction

User-provided direction: minimalist, clean, tidy, works on Windows and macOS (and Linux via browser), follows the OS light/dark theme. Read: personal utility, neutral visual language, ENERGY 1 / RHYTHM 1 / MOTION 1. One centered column with a constrained readable width, a clear Una Vault title, current lock status, one primary action at a time, and quiet secondary edit/delete/lock controls. No hero, dashboard, gradient, external font, illustration, unnecessary iconography, or animation. Use a system font stack, spacing and typography tokens, high-contrast text and visible keyboard focus. Test at 320/768/1024/1440 CSS pixels and high zoom; honor prefers-color-scheme and reduced motion.

Screens: setup (master + confirm), unlock, list (origin and account identifier only), add/edit (HTTPS website, username/email, password with optional show/hide, notes optional), delete confirmation, and safe success/error/loading/empty states. Labels remain visible. Never insert a saved password into the DOM when editing. Errors such as bad passphrase, invalid HTTPS origin, duplicate account, locked session, and expired UI session are actionable without echoing inputs. Protect against duplicate submits and maintain keyboard/assistive-technology feedback.

## Failure handling and verification

Bad passphrase, malformed field, multiple submissions, expired session, mismatched origin, invalid Host, missing CSRF, stale UI socket, and interrupted daemon fail without leaking secrets or modifying existing data unexpectedly. Rate-limit unlock failures without permanent account lockout; human can retry after a bounded delay. Recover only verified stale socket files after checking type, ownership, and that no daemon is listening; never unlink an active socket. No response or static asset may be cached with credential data. Apply restrictive CSP and security headers; serve no remote resources.

Use synthetic credentials in tests. Cover setup/unlock/add/edit/delete/lock; HTTP Host/Origin/CSRF/cookie validation; no secrets in URL, output, log, MCP replies, and server-rendered HTML; separate listener and loopback binding; MCP URL-capability negotiation and link fallback; stale socket startup; keyboard, focus, error announcements, OS themes, responsive layouts, and an end-to-end local-browser flow through una against synthetic data only. Do not inspect or test with the user's actual Instagram credentials. Use the frontend-expert responsive/accessibility quality gates and anything-good DURING mode with an evidence-backed delivery check.

## Source constraints

- OpenCode V2 MCP input requests: https://opencode.ai/v2/docs/mcp-servers#input-requests
- MCP elicitation (form mode MUST NOT request passwords; URL mode for sensitive interactions): https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
