import type { PageSession } from "../cdp/session";
import { UnaError } from "../errors";
import type { SnapNode } from "../view/snap";
import { parseFuseActions, buildExpression } from "./compiler";
import { pathsFor } from "./locate";
import { DETECT_JS } from "../state/detect";

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
  // Keep the fresh challenge guard in the same page pass as the fused actions.
  const chain = buildExpression(actions, paths, byRef);
  const expression = `(() => { const state = ${DETECT_JS}; if (state !== "loaded") return { challengeState: state }; return ${chain}; })()`;

  const res = await session.client.send("Runtime.evaluate", { expression, returnByValue: true });
  if (res.exceptionDetails) {
    throw new UnaError("cdp", `fuse evaluate error: ${JSON.stringify(res.exceptionDetails)}`);
  }
  const value = (res.result as { value?: FuseResult & { challengeState?: string } }).value;
  if (!value) throw new UnaError("cdp", "fuse returned no result");
  if (value.challengeState) {
    byRef.clear();
    if (["cf", "turnstile", "captcha", "hcaptcha", "forbidden", "rate"].includes(value.challengeState)) {
      throw new UnaError("challenge", `page is challenged or blocked (${value.challengeState})`, "run: una wait resolve, then una snap");
    }
    throw new UnaError("cdp", "fuse challenge detector could not read the page");
  }
  return value;
}
