import { UnaError } from "../errors";
import type { PageSession } from "../cdp/session";
import type { SnapNode } from "../view/snap";

export async function runChecks(session: PageSession, byRef: Map<string, SnapNode>, expect: string): Promise<unknown> {
  throw new UnaError("grammar", "check not implemented yet");
}