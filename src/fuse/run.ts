import type { PageSession } from "../cdp/session";
import { UnaError } from "../errors";
import type { SnapNode } from "../view/snap";
import { parseFuseActions, buildExpression } from "./compiler";
import { pathsFor } from "./locate";

export interface FuseResult {
  ok: boolean;
  done: number;
  results: Array<Record<string, unknown>>;
  first_fail?: { ref: string | null; code: string; message: string; hint?: string };
}

export async function runFuse(
  session: PageSession,
  byRef: Map<string, SnapNode>,
  cmds: string[],
): Promise<FuseResult> {
  const actions = parseFuseActions(cmds);

  const refs = new Set<string>();
  for (const a of actions) {
    if (a.verb === "check" && a.kind === "count") continue;
    if (a.ref) refs.add(a.ref);
  }

  const paths = await pathsFor(session, byRef, refs);
  const expression = buildExpression(actions, paths, byRef);

  const res = await session.client.send("Runtime.evaluate", { expression, returnByValue: true });
  if (res.exceptionDetails) {
    throw new UnaError("cdp", `fuse evaluate error: ${JSON.stringify(res.exceptionDetails)}`);
  }
  const value = (res.result as { value?: FuseResult }).value;
  if (!value) throw new UnaError("cdp", "fuse returned no result");
  return value;
}