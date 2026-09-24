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
6. **Success requires truth.** Do not claim a task done until `una check` returns
   PASS against live DOM: `text="..." url visible @e1 hidden @e1 count "#row" 3 input_value @e1="x"`.
7. **Prefer screenshots for visual claims only.** `una shot [path]` writes a PNG.

## Anti-bot (named decisions, never strings)

- Start the daemon with identity + harness: `una serve --id <name> [--mode headless|headed|attach[:port]] [--route <name>] [--browser chrome|chromium]`
- Named profiles persist cookies/cache under `~/.una/profiles/<id>`; prefer `--mode headed` or `--mode attach:<port>` (own real Chrome, `--remote-debugging-port=9222`) for strict sites.
- Every verb can target a named daemon: `una open <url> --id <name>`.
- `open` reports `{ state: loaded|challenge|blocked, kind: cf|turnstile|hcaptcha|captcha|forbidden|rate }`. Do not treat a challenge page as a loaded page.
- `una wait resolve [--timeout <ms>]` — poll until the challenge clears (managed CF sometimes auto-passes). If it stays `challenge`, switch to `--mode headed|attach` or hand off to a human.
- `una check state=loaded` must PASS before claiming success on a page that might be challenged.
- Actions (click/type/fill/select/scroll/get) on a challenged page error with `challenge` — re-resolve first, never guess.
- Routes are human-authored `~/.una/routes.json: { "us1": { "proxy": "socks5://…" } }` — the agent only picks `--route <name>`; 429/403 surfaces as `state: blocked`.
- `attach:<port>` drives an already-running real Chrome with a **non-default** profile (`--remote-debugging-port=<port>`). Google refuses sign-in from any CDP-driven Chrome ("This browser or app may not be secure") AND Chrome ≥154 refuses remote debugging on the default user-data-dir — but an existing Google session is reused in `attach` mode, so login once in that profile, then `una serve --id gmail --mode attach:9222` + `una open https://mail.google.com --id gmail` reads the real inbox without re-authentication.