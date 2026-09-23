#!/usr/bin/env bun
import { parseArgs } from "../src/args.ts";
import { run } from "../src/serve.ts";
import { isUnaError, UnaError } from "../src/errors.ts";

const argv = process.argv.slice(2);
const wantsJson = argv.includes("--json");

function print(payload: { code: string; message: string; hint?: string } | unknown): void {
  if (wantsJson) {
    console.log(JSON.stringify(payload));
    return;
  }
  if (typeof payload === "string") { console.log(payload); return; }
  if (payload && typeof payload === "object" && "message" in (payload as Record<string, unknown>)) {
    const p = payload as { code?: string; message?: string; hint?: string };
    console.log(p.message ?? "");
    if (p.hint) console.log(p.hint);
    return;
  }
  console.log(JSON.stringify(payload));
}

try {
  const cmd = parseArgs(argv);
  if (cmd.verb === "serve") {
    // never returns; daemon owns the process
    await import("../src/serve.ts").then((m) => m.startDaemonForever("talkback"));
  }
  const result = await run(cmd);
  print(result);
  process.exit(0);
} catch (e) {
  if (isUnaError(e)) {
    print({ code: e.code, message: e.message, hint: e.hint });
  } else {
    const err = e instanceof Error ? e : new Error(String(e));
    print({ code: "cdp", message: err.message, hint: undefined });
  }
  process.exit(1);
}