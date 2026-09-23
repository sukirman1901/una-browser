import { UnaError } from "../errors";
import { parseArgs } from "../args";
import type { Controller } from "../actions/exec";

export interface BatchItem {
  command: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; hint?: string };
}

export async function runBatch(ctrl: Controller, cmds: string[]): Promise<BatchItem[]> {
  const out: BatchItem[] = [];
  for (const cmd of cmds) {
    try {
      const c = parseArgs(cmd.trim().split(/\s+/));
      const result = await ctrl.exec(c);
      out.push({ command: cmd, ok: true, result });
    } catch (e) {
      const err = e instanceof UnaError ? e : new UnaError("cdp", e instanceof Error ? e.message : String(e));
      out.push({ command: cmd, ok: false, error: { code: err.code, message: err.message, hint: err.hint } });
    }
  }
  return out;
}
