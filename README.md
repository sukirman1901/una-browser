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

```jsonc
// opencode.json (or ~/.config/opencode/opencode.json)
{
  "mcp": {
    "una-mcp": {
      "type": "local",
      "command": ["bun", "src/mcp/server.ts"],
      "cwd": "/path/to/una-browser",
      "environment": { "UNA_MCP_MAIN": "1" }
    }
  }
}
```

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