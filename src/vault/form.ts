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

export type LoginStage = { stage: "username"; index: number } | { stage: "password"; index: number } | { stage: "both"; usernameIndex: number; passwordIndex: number };

export function selectLoginStage(inputs: LoginInput[]): LoginStage {
  const usable = inputs.filter((field) => field.visible && field.enabled);
  const passwords = usable.filter((field) => field.type === "password");
  const usernames = usable.filter((field) => ["email", "text", "tel"].includes(field.type));
  if (passwords.length > 1 || usernames.length > 1 || (!passwords.length && !usernames.length)) throw new Error("login form is missing or ambiguous");
  if (passwords.length && usernames.length) {
    if (passwords[0]!.form !== usernames[0]!.form) throw new Error("login form is missing or ambiguous");
    return { stage: "both", usernameIndex: usernames[0]!.index, passwordIndex: passwords[0]!.index };
  }
  return passwords.length ? { stage: "password", index: passwords[0]!.index } : { stage: "username", index: usernames[0]!.index };
}

export async function locateLoginForm(session: PageSession): Promise<{ stage: LoginStage["stage"]; usernameId?: number; passwordId?: number }> {
  const result = await session.client.send("Runtime.evaluate", {
    expression: `(() => Array.from(document.querySelectorAll('input')).map((input, index) => {
      const style = getComputedStyle(input);
       let visible = input.getClientRects().length > 0 && !input.closest('[aria-hidden="true"], [inert], [hidden]');
       for (let node = input; node && visible; node = node.parentElement) {
         const css = getComputedStyle(node);
         if (css.visibility === 'hidden' || css.visibility === 'collapse' || css.display === 'none' || Number(css.opacity) === 0) visible = false;
       }
       return { index, type: input.type, name: input.name, visible, enabled: !input.disabled && !input.readOnly, form: input.form ? String(Array.from(document.forms).indexOf(input.form)) : null };
    }))()`, returnByValue: true,
  });
  const inputs = (result.result as { value?: LoginInput[] }).value ?? [];
   const selected = selectLoginStage(inputs);
  const doc = await session.client.send("DOM.getDocument");
  const ids = await session.client.send("DOM.querySelectorAll", { nodeId: (doc.root as { nodeId: number }).nodeId, selector: "input" });
  const nodeIds = ids.nodeIds as number[];
   const getId = async (index: number) => {
     if (!nodeIds?.[index]) throw new Error("login form changed; retry");
     const node = await session.client.send("DOM.describeNode", { nodeId: nodeIds[index] });
     return (node.node as { backendNodeId: number }).backendNodeId;
   };
   if (selected.stage === "username") return { stage: "username", usernameId: await getId(selected.index) };
   if (selected.stage === "password") return { stage: "password", passwordId: await getId(selected.index) };
   return { stage: "both", usernameId: await getId(selected.usernameIndex), passwordId: await getId(selected.passwordIndex) };
}
