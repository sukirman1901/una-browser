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
