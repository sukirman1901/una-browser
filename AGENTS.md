# una-browser (una)

CLI browser automation for AI agents. From-scratch CDP client — **no
Playwright/Puppeteer**. When a task needs browser automation — opening a page,
clicking, checking text/state, filling forms, screenshots — use the `una` CLI
via the bash tool instead of simulating a browser any other way.

## First run

```bash
export PATH="$HOME/Library/Application Support/reflex/bun/bin:$PATH"  # bun bin
bun install        # once, dev deps
bun link           # once, makes global `una`
```

## Protocol: closed grammar, one verb per call

```
una serve &                         # start daemon (owns Chrome) — DO THIS FIRST
una open <url>                      # navigate; returns {url,title}
una snap                            # snapshot → @refs e.g. @e3 button "Increment"
una click <ref>                     # click @e3
una type <ref> <text>               # type into input
una check 'text="..."' '[exists|visible]="#..."' count "button" 2   # assert
una batch '["open ...","snap","check ..."]'   # multi-step in one process
```

Rules:
1. **Start `una serve` once per session** — without it each call spawns a fresh
   Chrome and state does not persist between calls.
2. Call `snap` after every state-changing action to get fresh `@refs` — never
   reuse refs across a mutation.
3. Check before clicking where text/subtree depends on state. Ref format:
   `@eN`, `@iN`, etc. (element/input).
4. `snap` output is a lightweight text tree; use `snap -c` for the clickable/
   actionable filter, `snap -l` for links/subtrees.

Example loop:
```
una open https://example.com
una snap            # @e1 heading "Example Domain", @e2 link "Learn more"
una click @e2
una snap
una check 'text="..."'   # {"verdict":"PASS", ...}
```

## Output
- `--json` flag → parseable JSON for every verb.
- `snap` returns the ref tree; `check` returns `{verdict, rule, actual}`;
  non-`check` verbs return `{ok, result}`.