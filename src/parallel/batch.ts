import { UnaError } from "../errors";
import type { Controller } from "../actions/exec";

export async function runBatch(ctrl: Controller, cmds: string[]): Promise<unknown[]> {
  throw new UnaError("grammar", "batch not implemented yet");
}