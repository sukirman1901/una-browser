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