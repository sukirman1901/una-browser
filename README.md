# una-browser (una)

From-scratch CDP browser-automation CLI for AI agents. Own WebSocket JSON-RPC
client — **no Playwright/Puppeteer**, no npm deps. Applies Jev/System One's
closed-grammar, ref-based, cheap-parallel method to the tool contract.

## Requirements
- [Bun](https://bun.sh) ≥ 1.3 — runtime, no npm deps
- Google Chrome (or Chromium; override path via `UNA_CHROME`)

## Install
```sh
# from this repo — clone, install, link globally
git clone https://github.com/sukirman1901/una-browser.git
cd una-browser
bun install        # dev only (@types/bun)
bun link           # global `una` command
bun link --global una-browser   # alt: explicit global link
```

or install it as a dependency inside any Bun project:

```sh
bun add github:sukirman1901/una-browser
bunx una --json meta   # or via node_modules/.bin/una
```

Then verify:

```sh
una    # prints the known verbs: open snap click type fill select scroll wait get check shot batch serve skill
```

## MCP (optional — native tools in opencode/cursor/Claude)

Expose `una` as MCP tools (`una_open`, `una_snap`, `una_click`, …) instead of
shell calls. The server is a thin stdio proxy to the daemon — no logic of its
own, so the CLI stays the source of truth.

**One-shot setup** (installs deps, links `una`, registers the `una` MCP in your
opencode config — project `opencode.json` first, else global):

```sh
bun src/mcp/setup.ts
# cd into your project first to register there, or pass --config explicitly:
bun /path/to/una-browser/src/mcp/setup.ts --config "/your/project/opencode.json"
```

Or register manually:

```jsonc
// opencode.json (or ~/.config/opencode/opencode.json)
{
  "mcp": {
    "una": {
      "type": "local",
      "command": ["bun", "src/mcp/server.ts"],
      "cwd": "/path/to/una-browser",
      "environment": { "UNA_MCP_MAIN": "1" }
    }
  }
}
```

Tool names mirror the CLI verbs: `una_open`, `una_snap`, `una_click`,
`una_check`, `una_batch`, etc.

Restart opencode after saving. The server lazy-starts a daemon if none is
running; existing daemons (any `UNA_PORT`) are reused, so state persists.

## Use (agent loop)
```sh
una serve &                                   # one daemon per session
una open https://typesafe.ai
una snap
# @e1 heading "TypeSafe AI"
una click @e3
una snap
una check 'text="System One"'                 # → {"verdict":"PASS"}
```

## Commands
open snap click type fill select scroll wait get check shot batch serve skill

## Challenge handling

Una detects visible CAPTCHA/Cloudflare challenges; it does not include an AI
CAPTCHA solver. Use a persistent headed/attached browser for human assistance.
When launching `una serve` from an agent shell, use background execution with no
process timeout (OpenCode: `background: true, timeout: 0`). An external timeout
terminates the daemon and closes its Chrome; a page wait cannot extend it.
`una wait resolve --timeout 30000` returns `{state, kind, outcome}` with outcome
`resolved`, `timed_out`, or `blocked`. Blocked pages (403/429 markers) return
immediately; do not repeatedly retry them. Detector read errors fail rather than
claiming the page is loaded. These are DOM-based signals, not an HTTP status audit.

Ordinary actions (including eval and fuse) remain available on challenged pages;
detected state is informational, not an automatic action block. `vault fill`
still refuses challenged/blocked pages and preserves all exact HTTPS-origin and
unlock requirements.

After resolving a challenge, take a fresh `una snap` (old refs are invalidated
when wait or the vault guard detects a challenge) and verify the intended page/form result.
`resolved` is not proof of login or submission success.

### Active-model visual workflow

MCP `vision_observe` sends a viewport PNG to the connected multimodal agent,
along with dimensions, challenge state, and a one-use `captureId`. The agent
reasons about that actual image and calls `vision_click({captureId,x,y})` using
screenshot-pixel coordinates. Native CDP input can interact with visible iframe
content without adding cross-origin DOM refs. Re-observe after each action.

CLI equivalent (keep the same daemon/identity for every call):

```sh
una vision observe /path/to/new-capture.png
# Inspect the saved PNG with your agent's image reader. Use coordinates from it:
una vision click <capture-id> <x> <y>
una vision observe /path/to/next-capture.png
una check state=loaded
```

Captures expire after 30 seconds and are rejected after reuse, replacement,
navigation, viewport/scroll changes, main-document DOM changes, or intervening
controller actions. Image/CSS pixel scaling is handled automatically. Visual
observations may be saved only to a new explicit file (mode 0600); existing files
are not overwritten. Without a path, the CLI returns inline PNG data like the
daemon. Screenshots are sent only to the connected agent, not a separate solver
API; avoid capturing visible secrets or unrelated private content.

For dynamic replacement tiles, use `una wait 500` for a bounded render delay
before capturing the next image. For overall clearance use
`una wait resolve --timeout 10000` (MCP: `wait({target:"resolve",timeout:10000})`).
Every wait requires a new visual capture before another click. Wait timeouts do
not close the browser. Pausing at the agent's attempt/time budget must likewise
leave the daemon/tab open for human handoff; it must not kill or restart Chrome.

The active agent supplies the model and orchestration: this is **not a bundled
AI solver or a guarantee that real CAPTCHAs will pass**. The workflow instructions
limit the agent to 8 visual actions / 2 minutes, then human handoff; these budgets
are not a hidden loop inside the CLI. A click never reports `solved`; verify the
page result separately. Cross-origin animation/canvas changes cannot be fully
tracked, so capture freshness is best-effort. Local fixture tests demonstrate
iframe input and lifecycle, not model accuracy against CAPTCHA providers.

## Local credential vault (opt-in)

The daemon also serves a small local vault page on its own loopback port.
Open the address provided by `vault_open` in your **ordinary browser**, not
in una's automated Chrome. Create or unlock your vault, then add/edit/delete
logins there; the page follows your OS light/dark theme. The master passphrase
is still needed once per daemon restart. Never enter real vault secrets in a
browser that an agent controls through CDP/DevTools.

The terminal workflow below remains available as a fallback:

Start `una serve` first. In a **personal interactive terminal**, run:

```sh
una vault init      # enter and confirm a master passphrase (hidden input)
una vault add       # enter HTTPS website, username/email, password, notes
una vault list      # shows site, account ID and username; never password or notes
una vault lock      # forget the unlocked key; `una vault unlock` to restore it
```

When an HTTPS login page is open, call `una vault fill` (or MCP `vault_fill`).
If there is more than one account for that exact origin, choose an ID from
`una vault list` and call `una vault fill <account-id>`. Filling never submits
the form. `una vault edit` and `una vault delete` provide interactive
management. With a named daemon use `--id <name>` on both `serve` and vault
commands. A daemon restart requires `una vault unlock` again. Keep a secure
backup of `~/.una/vault/data.json`: a lost master passphrase cannot be reset
or recovered by una.

The vault encrypts credentials at rest with scrypt (N=32768, r=8, p=1) and
AES-256-GCM. Management and unlocking use a private Unix socket under a
0700 directory (socket mode 0600); the daemon's ordinary HTTP/MCP interface
only supports nonsecret `vault status`, `vault list`, and `vault fill`. Only
exact HTTPS origins (including port) match; HTTP and parent/subdomains do
not. This protects against accidental transcript/CLI-argument exposure, **not**
against other programs running as your OS user, a malicious website receiving
a filled password, or a harness that uses una's `eval`, snapshots, or Chrome
DevTools to read form values after fill. Unlock and store real credentials
yourself; never send them to an agent or paste them into chat. The current
MCP server's `type`/`fill` tools can still accept literal text; do not use
those tools to enter vault secrets.

## Why
- Refs-only snapshot alphabet → agent never writes selectors (can't hallucinate).
- `check` = RLVR: truth from live DOM, not preference.
- `batch`/`serve` = cheap parallel sampling (Jev "sampler not parser").
- Daemon keeps Chrome alive; ~1 ms warm daemon round-trip, ~100 ms per CLI spawn.

## Env
- `UNA_CHROME` — path to Chrome binary
- `UNA_PORT` — daemon port (default 17911)

## Notes
- `snap -s` scopes are parsed but subtree filtering is upcoming — v1 snapshots are full-tree.

## Layout
bin/una.ts → args.ts (closed grammar) → serve.ts (daemon/proxy) → Controller →
cdp/{launcher,client,session,dom,a11y} → view/snap + verify/check + parallel/batch
