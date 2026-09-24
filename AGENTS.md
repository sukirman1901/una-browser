# una-browser (una)

CLI + MCP browser automation for AI agents. From-scratch CDP client — **no
Playwright/Puppeteer**.

**Tool priority (in this order):**
1. **MCP tools `una_*`** (when available — opencode, cursor, other MCP hosts):
   `una_open <url>`, `una_snap`, `una_click @e3`, `una_check 'text="..."'`,
   `una_batch '[...]'`. Native, no shell.
2. **`una` CLI via the bash tool** — same grammar, prefix `una <verb>`:
   `una open`, `una snap`, `una click`.
3. **Anything else** (`webfetch`, `websearch`, pocket, ...) — use ONLY as a
   fallback if una fails or for non-browser text lookup the user asks for.

**Every task that touches a live site — reading content, clicking, checking
state/form, screenshots — goes through una.** Even plain "study this site"
means drive it: `open` → `snap` / `snap -c` → read refs → `check` when needed.
Do not silently switch to webfetch for site reading.

## First run

```bash
export PATH="$HOME/Library/Application Support/reflex/bun/bin:$PATH"  # bun bin
bun install        # once, dev deps
bun link           # once, makes global `una`
```

## Protocol: closed grammar, one verb per call

Daemon semantics are the same for MCP and CLI. If no daemon is running, the
server/CLI starts one lazily — but for a multi-call session prefer one started
upfront so state persists between calls.

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

Example loop (CLI shown; MCP uses the same refs via `una_click` etc.):
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
- MCP tools return the same JSON in `content[0].text`.