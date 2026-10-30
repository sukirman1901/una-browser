# una — core rules (Jev / System One)

You control a real browser through `una` Bash commands. It is a *sampler*,
not a parser: speak its closed grammar, never your own.

1. **Refs only, never selectors.** Interact via `@eN` from the LATEST `una snap`.
   Never write CSS/XPath/JS; never hardcode a ref from an old snapshot.
2. **Snapshot is the alphabet.** After any mutation (click/type/fill/select),
   re-run `una snap` before touching more refs. Rarely, run `snap -c` (compact)
   when you only need interactive elements; run `snap -d 3` to limit depth.
3. **stale_ref = truth.** A `stale_ref` error means the element is gone — re-snap,
   never guess or renumber. If a verb errors grammar, fix the command, do not work around it.
4. **Start the daemon once per session:** `una serve` (background). Cheap use
   means you can sample the page many times, like Jev samples hypotheses.
5. **Parallelize cheaply.** Bundle independent steps with `una batch` in ONE process:
   `una batch '["open U","snap","check text=X"]'`. Keep batch args simple (no spaces in args).
   For a harvest of unrelated urls in parallel: `una parallel '{"urls":["https://a","https://b"],"js":"() => document.title"}'`
   — up to 8 urls, one ephemeral tab per job, per-job error isolation, the manual tab list and
   focus are untouched.
6. **Multi-tab in one daemon.** `una tab <url>` opens and focuses a new tab, `una tabs` lists
   all (`{index,url,title,active}`), `una switch <index|url-prefix>` re-focuses,
   `una close <index>` removes it (remaining tabs renumber). Refs `@eN` always resolve against
   the **focused** tab — `switch` first, then `snap`, then act. Pastes on the wrong tab are real
   corruption; never assume which tab is active.
7. **Success requires truth.** Do not claim a task done until `una check` returns
   PASS against live DOM: `text="..." url visible @e1 hidden @e1 count "#row" 3 input_value @e1="x"`.
8. **Prefer screenshots for visual claims only.** `una shot [path]` writes a PNG.

## Vault (opt-in)

Prefer the local vault UI: call `vault_open` and give the human the loopback
link to open in their **ordinary browser** (not the una-controlled Chrome) to
initialize, unlock, add/edit/delete, and lock. Never open that page yourself.
Only the human uses an interactive terminal for `una vault init|add|unlock`
(fallback). Never request passwords in chat or pass secrets via `una type|fill`,
MCP, or CLI arguments. Once unlocked, `una vault status|list|fill [account-id]`
(MCP:
`vault_status`, `vault_list`, `vault_fill`) can fill a login form on the exact
HTTPS origin. It does not submit the form. Multiple accounts require an ID
from `vault_list`; password and notes are not returned. **Filled values can
still be read via `eval`, DOM snapshots, page scripts and DevTools.** Do not
claim the vault isolates secrets from a hostile agent or website.

## Fuse: one-pass action chains

`una fuse '["click @e3","fill @i1 \"x\"","check text=\"ok\""]'`

Compiles click/type/fill/select/check/get into ONE Runtime.evaluate (plus one
DOMSnapshot for structural paths). Stops at the first thrown error
(`{done, first_fail}`); check FAILs are recorded in `results` and the chain
continues — same rule as batch. Supported subset: click, type, fill, select,
check (kinds text/url/visible/hidden/count/input_value — NOT state), get.

## Anti-bot (named decisions, never strings)

- Start the daemon with identity + harness: `una serve --id <name> [--mode headless|headed|attach[:port]] [--route <name>] [--browser chrome|chromium]`
- Keep the daemon persistent: background it without an execution timeout (`background: true, timeout: 0` in OpenCode shell). A finite harness timeout sends SIGTERM and closes Chrome; `una wait` cannot extend it. Bound waits/agent attempts, not the daemon lifetime.
- Named profiles persist cookies/cache under `~/.una/profiles/<id>`; prefer `--mode headed` or `--mode attach:<port>` (own real Chrome, `--remote-debugging-port=9222`) for strict sites.
- Every verb can target a named daemon: `una open <url> --id <name>`.
- `open` reports `{ state: loaded|challenge|blocked, kind: cf|turnstile|hcaptcha|captcha|forbidden|rate }`. Do not treat a challenge page as a loaded page.
- `una wait resolve [--timeout <ms>]` — poll until the challenge clears (managed CF sometimes auto-passes). If it stays `challenge`, switch to `--mode headed|attach` or hand off to a human.
- Wait returns `{state, kind, outcome}`: `resolved`, `timed_out`, or `blocked`. A timeout is not success; blocked pages return immediately. After a challenge, take a fresh `snap` before using refs.
- Detector read failures raise `cdp`; they never establish `loaded`. Use `check state=...` to re-observe after navigation or interaction.
- `una check state=loaded` must PASS before claiming success on a page that might be challenged.
- `resolved` only means no challenge was detected; verify the intended page/form result separately. Una has no built-in AI CAPTCHA solver.
- Ordinary actions, including eval and fuse, are not blocked just because a page is challenged. Use observed refs, respect rate limits, and verify the outcome rather than assuming an action cleared the challenge. `vault fill` still re-detects and refuses challenged/blocked pages, in addition to requiring an unlocked vault and exact HTTPS origin.
- Routes are human-authored `~/.una/routes.json: { "us1": { "proxy": "socks5://…" } }` — the agent only picks `--route <name>`; 429/403 surfaces as `state: blocked`.
- `attach:<port>` drives an already-running real Chrome with a **non-default** profile (`--remote-debugging-port=<port>`). Google refuses sign-in from any CDP-driven Chrome ("This browser or app may not be secure") AND Chrome ≥154 refuses remote debugging on the default user-data-dir — but an existing Google session is reused in `attach` mode, so login once in that profile, then `una serve --id gmail --mode attach:9222` + `una open https://mail.google.com --id gmail` reads the real inbox without re-authentication.

## Agent-driven visual challenge workflow

Use only for a user-requested interaction on a site they may access. Prefer DOM
refs normally; when a visible iframe/canvas control has no usable ref:

1. Call MCP `vision_observe` (CLI: `una vision observe <new-image.png>`). MCP
   returns an actual PNG image plus `{captureId,width,height,viewport,state,kind}`.
   CLI saves the image at the explicit path; inspect it with the host's image reader.
2. The active visual model reasons from that image, not from guessed page layout.
   If the target is unambiguous, call `vision_click({captureId,x,y})` / CLI
   `una vision click <capture-id> <x> <y>`. Coordinates are screenshot pixels,
   not CSS pixels. Native CDP input can reach visible iframe content without DOM refs.
3. Observe again after every click. Each capture is single-use and expires after
   30 seconds; navigation, viewport/scroll, main-document DOM changes, and intervening
   controller actions invalidate it. Animated canvas or cross-origin frame changes
   are not completely tracked: this is best-effort freshness, not a security boundary.
   For dynamic replacement tiles, use a short bounded `wait <ms>` before the next
   observation; for overall clearance use `wait resolve --timeout <ms>` (MCP
   `wait({target:"resolve",timeout:...})`). Always capture after waiting, not before.
4. A successful click is NOT a successful solve. Verify fresh challenge state and
   the intended application result. If uncertainty remains, report it, never claim success.
5. Stop after at most 8 visual actions or 2 minutes, on rate blocking, or after
   repeated failures. Ask for human help; do not rotate identities or repeatedly retry.
   Stop actions only: preserve the daemon/tab/browser for human handoff and resume.
   A wait timeout is `timed_out`, not a reason to kill Chrome or restart the session.

The host agent supplies the model and must enforce the workflow budget. Una does
not run a hidden model loop, call a paid solver, inject challenge tokens, or promise
support for every CAPTCHA. No automatic login submission or unrelated side effects.
Screenshots expose visible page content to the connected model: never capture
shown passwords, recovery codes, vault management, or unrelated private content.
