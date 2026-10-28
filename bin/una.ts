#!/usr/bin/env bun
import { parseArgs, flagValue } from "../src/args.ts";
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
  if (payload && typeof payload === "object" && "code" in (payload as Record<string, unknown>) && "message" in (payload as Record<string, unknown>)) {
    const p = payload as { code?: string; message?: string; hint?: string };
    console.log(p.message ?? "");
    if (p.hint) console.log(p.hint);
    return;
  }
  console.log(JSON.stringify(payload));
}

try {
  if (argv[0] === "vault" && argv[1] !== "fill") {
    const { vaultCliRequest } = await import("../src/vault/prompt.ts");
    const { sendVaultRequest } = await import("../src/vault/ipc.ts");
    const { daemonPort, idPort } = await import("../src/identity.ts");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const id = flagValue(argv, "--id");
    const args = argv.slice(1).filter((a, i, all) => a !== "--json" && a !== "--id" && all[i - 1] !== "--id");
    const request = await vaultCliRequest(args);
    const port = id ? (daemonPort(id) ?? idPort(id)) : Number(process.env.UNA_PORT ?? 17911);
    const reply = await sendVaultRequest(process.env.UNA_ROOT ?? join(homedir(), ".una"), port, request);
    if (!reply.ok) throw new Error(reply.error ?? "vault operation failed");
    print(reply.result ?? { ok: true });
    process.exit(0);
  }
  const cmd = parseArgs(argv);
  if (cmd.verb === "serve") {
    await import("../src/serve.ts").then((m) =>
      m.startDaemonForever("talkback", { id: cmd.id, mode: cmd.mode, route: cmd.route, browser: cmd.browser }),
    );
  }
  const id = flagValue(argv, "--id");
  const result =
    cmd.verb === "batch"
      ? await run({ commands: cmd.cmds }, id)
      : cmd.verb === "parallel"
        ? await run({ parallel: cmd.jobs }, id)
        : await run({ cmd: argv.filter((a) => a !== "--json").join(" ") }, id);
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
