# una-browser — Design Spec

Date: 2026-09-24 · Status: approved · Author: brainstorm with user

## Goal

A browser-automation **CLI tool** that any AI agent (opencode, Cursor, Claude Code,
etc.) can drive from its Bash tool. It applies the **System One method** of Jev
(TypeSafe AI) to the *tool contract* — not to the model — so it is model-agnostic
and universally fast.

The tool is written **from scratch** (own CDP client, no Playwright/Puppeteer)
and named `una` (project `una-browser`).

## System One principles → tool mapping

| Principle | In `una` |
|---|---|
| Decisions, not strings | Snapshot is the decision space: agent picks `@eN` refs, never writes selectors/HTML. Compact output (~300 tokens). |
| Closed answer space | Strict grammar, hard validation: `una <verb> <subject> [flags]`. Unknown command/flag → structured error, never guessed. |
| Can't hallucinate | Stale refs → explicit `stale_ref` error + re-snapshot hint. Tool never assumes/guesses state. |
| Verification (RLVR analog) | `check` (assert) built-in: truth measured from real DOM, not agent preference. Success claims must pass `check`. |
| Parallel sampler | `batch` (many commands, one process), `snap -s a,b,c` (many scopes, one round-trip), `--session` (isolated fan-out). |
| Cheap & fast | Long-lived daemon (Chrome never relaunched), native WebSocket, 0-dependency core, compact JSON everywhere. |

## Tech stack

- Bun 1.3.3 + TypeScript (strict)
- Raw CDP client written in-repo (native `WebSocket` from Bun, `fetch`, `JSON`; **no npm deps** in core)
- Tests: `bun:test` against a local HTTP fixture server + headless Chrome

## CLI surface (simple naming)

```
una open <url>                 navigate
una snap [-i] [-s a,b,c] [-u] [-c] [-d N]   accessibility snapshot → @eN refs
una click <ref>                click element
una type <ref> <text>          type (append)
una fill <ref> <text>          clear + type
una select <ref> <value>       dropdown select
una scroll up|down|left|right [px]
una wait <sel|ms|load>         block until ready
una get <ref|sel>              extract text/value/html (small JSON)
una check <expect=...>          assert: text|url|visible|hidden|count|input_value → PASS/FAIL
una shot [path]                screenshot
una batch '[...]'              parallel: many commands one process
una serve                      daemon (owns Chrome via CDP)
una skill                      print core skill instructions
```

All commands support `--json`. Flags: `-i` interactive-only, `-s` scopes, `-u`
urls on links, `-c` compact, `-d` depth cap.

## Architecture

```
una-browser/
├── bin/una.ts                 entry, arg parser → command union
├── package.json / tsconfig.json   (no deps in core)
├── src/
│   ├── args.ts                schema validation (closed grammar)
│   ├── cdp/
│   │   ├── launcher.ts        spawn Chrome --headless=new --remote-debugging-port=0 --user-data-dir=tmp
│   │   ├── client.ts          WS transport + JSON-RPC id→Promise map
│   │   ├── session.ts         tab / multi-session (--session name), ref map
│   │   ├── dom.ts             Runtime.evaluate, resolve element, Input.dispatchMouseEvent at box center, scrollIntoViewIfNeeded
│   │   └── a11y.ts            Accessibility.getFullAXTree → flatten, filter interactive+visible, assign @eN
│   ├── view/snap.ts           snapshot serializer (~300 tokens), scopes
│   ├── actions/{schema,exec}.ts  strict grammar validators + executors
│   ├── verify/check.ts         assert impl (PASS/FAIL + actual value)
│   ├── parallel/batch.ts       many commands one process
│   ├── serve.ts                daemon lifecycle (thin client = μs overhead per call)
│   ├── skills/core.md          agent-facing instructions (Jev rules)
│   └── errors.ts               structured errors: code + message + hint
└── test/
    ├── server.ts               local HTTP fixture
    ├── cdp.test.ts
    ├── snap.test.ts            ref stability
    ├── actions.test.ts         click/fill/select
    └── check.test.ts           PASS/FAIL, stale_ref
```

## Key behaviors

- **Daemon**: `una serve` keeps one Chrome (persistent `user-data-dir`) alive.
  Thin CLI calls proxy to daemon over localhost; per-call overhead ~5–15 ms.
  Chrome is never relaunched per invocation.
- **Ref stability**: daemon stores `nodeId ↔ @en` map. Action on stale ref:
  re-resolve; if element gone → `stale_ref` error with hint to re-snapshot.
- **Closed grammar**: `args.ts` validates everything upfront. Any unknown verb,
  ref, or flag → `grammar` error (code, message, hint) + correct exit code.
- **check (assert)**: truth measured against live DOM. Returns PASS/FAIL plus
  actual observed value. Used by agents to gate "success" claims.
- **parallel**: `batch` runs many commands in one process; `snap -s a,b,c`
  evaluates many scopes in one `Runtime.evaluate`; `--session` isolates fan-out
  work.
- **skills/core.md** encodes the Jev rules agents must follow: refs only from
  latest snapshot; stale → re-snapshot, never guess; success requires `check`.

## Error model

Every error is `{ code, message, hint }`, exit code != 0. Codes: `stale_ref`,
`not_found`, `grammar`, `timeout`, `cdp`.

## Testing

`bun:test` + local fixture server (no external network / no Playwright):
snapshot ref stability · click / fill / select · check PASS/FAIL · stale_ref ·
parallel batch · screenshot file written.

## Out of scope (v1)

- No model integration (model-agnostic by design)
- No MCP server wrapper (CLI via Bash is the universal surface)
- No cloud browser providers