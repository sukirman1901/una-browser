# una-browser (una)

CLI + MCP browser automation for AI agents. From-scratch CDP client — **no
Playwright/Puppeteer**.

**Tool priority (in this order):**
1. **MCP tools** (when available — opencode, cursor, other MCP hosts):
   `open <url>`, `snap`, `click @e3`, `check 'text="..."'`, `batch [...]`, plus
   `vault_open` / `vault_status` / `vault_list` / `vault_fill`. Native, no shell.
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
una check 'text="..."'   # assert — kinds: text="...", url, visible @e1,
                         # hidden @e1, count "#row" 3, input_value @e1="..."
una batch '["open ...","snap","check ..."]'   # multi-step in one process
una fuse '["click @e3","check text=\"...\""]'   # N actions → ONE page pass (one evaluate)
```

Profiles: pass `--id <name>` to any verb (including `serve`) to isolate that
daemon's Chrome profile (`~/.una/profiles/<id>`). An id-less daemon persists in
`~/.una/profiles/default`, so manual logins survive restarts.

Handling daemons: stop it with `kill -TERM <pid>` (or Ctrl-C) — the daemon
catches the signal, closes the vault, and quits its own Chrome. If a daemon
is killed with `kill -9` and the next `una serve` says the profile is locked
by another Chrome, kill the orphan first: `lsof -nP +D ~/.una/profiles/<id>`.

Rules:
1. **Start `una serve` once per session** — without it each call spawns a fresh
   Chrome and state does not persist between calls.
2. Call `snap` after every state-changing action to get fresh `@refs` — never
   reuse refs across a mutation.
3. Check before clicking where text/subtree depends on state. Ref format:
   `@eN`, `@iN`, etc. (element/input).
4. `snap` output is a lightweight text tree; `snap -i` shows only
   interactive/actionable elements, `snap -u` includes links/urls,
   `-s` scopes the tree, `-d N` caps depth.
5. `fuse` runs click/type/fill/select/check/get as a single in-page pass — one
   DOM snapshot + one evaluate — stopping at the first failure. check FAILs are
   recorded, the chain continues. Use it to cut latency on multi-step sequences.

Example loop (CLI shown; MCP tools take the same refs):
```
una open https://example.com
una snap            # @e1 heading "Example Domain", @e2 link "Learn more"
una click @e2
una snap
una check 'text="..."'   # {"verdict":"PASS", ...}
```

## Multi-tab & parallel

```
una tab <url>                # open + focus a new tab; {index,url,title}
una tabs                     # [{index,url,title,active}] — manual tab list
una switch 1                 # focus by index, or unique url-substring, e.g. `switch example.com`
una close 1                  # close by index; remaining tabs renumber
una parallel '{"urls":["https://a","https://b"],"js":"() => document.title"}'
                             # ≤8 urls, one ephemeral tab each, in parallel
```

Refs (`@eN`) resolve against the **focused** tab only — `switch` before acting
on another tab, then `snap` for fresh refs. `close` of the last tab errors
(`no tabs left`) to guard pastes. `parallel` needs a daemon (`una serve`)
and never mutates the manual tab list or focus.

## Output
- `--json` flag → parseable JSON for every verb.
- `snap` returns the ref tree; `check` returns `{verdict, rule, actual}`;
  non-`check` verbs return `{ok, result}`.
- MCP tools return the same JSON in `content[0].text`.

## Vault (opt-in)

Prefer the local vault UI: call `vault_open` and give the human the loopback
link (http://127.0.0.1:<port>/). They open it in their **ordinary browser** —
not the una-controlled Chrome — to initialize, unlock, add/edit/delete, and
lock. Never open that page with `una open`, and never ask for vault secrets in
chat, MCP forms, or CLI arguments. Do not request passwords in chat, pass them
as CLI arguments, or send them to MCP `type`/`fill`.
When the human has unlocked the daemon, use `vault_status`, `vault_list` and
`vault_fill` (or `una vault fill [account-id]`) on an exact-match HTTPS login
page; it fills but does not submit. It is stage-aware: on staged logins (e.g.
X) it fills only the visible field and returns `{stage}` — `username`,
`password`, or `both`; re-call it after the site advances the form. If it
reports "vault is locked", it includes the vault UI link in the hint;
`una vault ui` prints the same loopback link. If several accounts match,
choose an ID from `vault_list`. `vault_list` includes usernames, not
passwords or notes.
After filling, `eval`, DOM snapshots and Chrome DevTools can still reveal
field values; una is **not** a security boundary against a malicious harness.
