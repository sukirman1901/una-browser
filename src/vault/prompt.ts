import type { VaultRequest } from "./ipc";

async function hiddenInput(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error("vault secrets require an interactive terminal");
  process.stderr.write(`${label}: `);
  const input = process.stdin;
  const previous = input.isRaw;
  input.setRawMode(true);
  input.resume();
  try {
    return await new Promise<string>((resolve, reject) => {
      let text = "";
      const cleanup = () => { input.off("data", onData); input.off("end", onEnd); };
      const onEnd = () => { cleanup(); reject(new Error("terminal closed")); };
      const onData = (buffer: Buffer) => {
        for (const char of buffer.toString("utf8")) {
          if (char === "\r" || char === "\n") { cleanup(); resolve(text); return; }
          if (char === "\u0003") { cleanup(); reject(new Error("cancelled")); return; }
          if (char === "\u007f" || char === "\b") text = text.slice(0, -1);
          else if (char >= " ") text += char;
        }
      };
      input.on("data", onData);
      input.once("end", onEnd);
    });
  } finally {
    input.setRawMode(previous);
    input.pause();
    process.stderr.write("\n");
  }
}

export function vaultCliRequest(args: string[]): Promise<VaultRequest> {
  const [action, ...extra] = args;
  if (extra.length || !["init", "unlock", "add", "edit", "delete", "lock", "list", "status"].includes(action ?? "")) {
    throw new Error("usage: una vault init|unlock|add|edit|delete|lock|list|status (no credential arguments)");
  }
  return (async () => {
    switch (action) {
      case "init": {
        const passphrase = await hiddenInput("Master passphrase");
        const repeat = await hiddenInput("Repeat master passphrase");
        if (!passphrase || passphrase !== repeat) throw new Error("master passphrases do not match");
        return { action, passphrase };
      }
      case "unlock": return { action, passphrase: await hiddenInput("Master passphrase") };
      case "add": {
        const website = await hiddenInput("HTTPS website URL");
        const username = await hiddenInput("Username or email");
        const password = await hiddenInput("Password");
        const notes = await hiddenInput("Notes (optional)");
        return { action, credential: { website, username, password, notes } };
      }
      case "edit": {
        const id = await hiddenInput("Account ID (from vault list)");
        const website = await hiddenInput("HTTPS website URL");
        const username = await hiddenInput("Username or email");
        const password = await hiddenInput("New password");
        const notes = await hiddenInput("Notes (optional)");
        return { action, id, credential: { website, username, password, notes } };
      }
      case "delete": return { action, id: await hiddenInput("Account ID to delete (permanent)") };
      case "lock": case "list": case "status": return { action };
      default: throw new Error("unsupported vault action");
    }
  })();
}
