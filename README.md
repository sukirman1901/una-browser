# una-browser (una)

From-scratch CDP browser-automation CLI for AI agents. Own WebSocket JSON-RPC
client — **no Playwright/Puppeteer**, no npm deps. Applies Jev/System One's
closed-grammar, ref-based, cheap-parallel method to the tool contract.

## Install
```sh
bun install        # dev only (@types/bun)
bun link           # optional: global `una`
```

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
- Daemon keeps Chrome alive; per-call ~5–15 ms.

## Env
- `UNA_CHROME` — path to Chrome binary
- `UNA_PORT` — daemon port (default 17911)

## Layout
bin/una.ts → args.ts (closed grammar) → serve.ts (daemon/proxy) → Controller →
cdp/{launcher,client,session,dom,a11y} → view/snap + verify/check + parallel/batch