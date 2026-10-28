import type { PageSession } from "../cdp/session";

export interface LoginInput {
  index: number;
  type: string;
  name: string;
  visible: boolean;
  enabled: boolean;
  form: string | null;
}

export function selectLoginForm(inputs: LoginInput[]): { usernameIndex: number; passwordIndex: number } {
  const usable = inputs.filter((field) => field.visible && field.enabled);
  const passwords = usable.filter((field) => field.type === "password");
  if (passwords.length !== 1) throw new Error("login form is missing or ambiguous");
  const password = passwords[0]!;
  const usernames = usable.filter((field) => field.form === password.form && ["email", "text", "tel"].includes(field.type));
  if (usernames.length !== 1) throw new Error("login form is missing or ambiguous");
  return { usernameIndex: usernames[0]!.index, passwordIndex: password.index };
}

export async function locateLoginForm(session: PageSession): Promise<{ usernameId: number; passwordId: number }> {
  const result = await session.client.send("Runtime.evaluate", {
    expression: `(() => Array.from(document.querySelectorAll('input')).map((input, index) => {
      const style = getComputedStyle(input);
      return { index, type: input.type, name: input.name, visible: input.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none', enabled: !input.disabled && !input.readOnly, form: input.form ? String(Array.from(document.forms).indexOf(input.form)) : null };
    }))()`, returnByValue: true,
  });
  const inputs = (result.result as { value?: LoginInput[] }).value ?? [];
  const selected = selectLoginForm(inputs);
  const doc = await session.client.send("DOM.getDocument");
  const ids = await session.client.send("DOM.querySelectorAll", { nodeId: (doc.root as { nodeId: number }).nodeId, selector: "input" });
  const nodeIds = ids.nodeIds as number[];
  if (!nodeIds?.[selected.usernameIndex] || !nodeIds?.[selected.passwordIndex]) throw new Error("login form changed; retry");
  const username = await session.client.send("DOM.describeNode", { nodeId: nodeIds[selected.usernameIndex] });
  const password = await session.client.send("DOM.describeNode", { nodeId: nodeIds[selected.passwordIndex] });
  return { usernameId: (username.node as { backendNodeId: number }).backendNodeId, passwordId: (password.node as { backendNodeId: number }).backendNodeId };
}
