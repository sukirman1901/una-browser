import { startDaemon, stopDaemon, healthUrl, type Daemon } from "../serve";

const NAME = "una";
const VERSION = "0.1.0";
const PROTOCOL_VERSION = "2025-03-26";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[] };
  build: (args: Record<string, unknown>) => { cmd: string } | { commands: string[] };
}

function texts(...parts: string[]): Array<{ type: "text"; text: string }> {
  return parts.map((text) => ({ type: "text", text }));
}

const TOOLS: ToolDef[] = [
  { name: "open", description: "Navigate to a URL. Returns {url,title}.", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }, build: (a) => ({ cmd: `open ${a.url}` }) },
  { name: "snap", description: "Snapshot the page into a text tree of @refs. Returns the ref tree; any state-changing action invalidates refs — re-snap after each mutation.", inputSchema: { type: "object", properties: { interactive: { type: "boolean", description: "-i: clickables/actionables only" }, urls: { type: "boolean", description: "-u: include links/urls" }, compact: { type: "boolean", description: "-c: lightweight/actionable filter" }, depth: { type: "number", description: "-d N: max depth of the tree" } }, required: [] }, build: (a) => { let s = "snap"; if (a.interactive) s += " -i"; if (a.urls) s += " -u"; if (a.compact) s += " -c"; if (a.depth !== undefined) s += ` -d ${a.depth}`; return { cmd: s }; } },
  { name: "click", description: "Click an element by ref, e.g. @e3.", inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] }, build: (a) => ({ cmd: `click ${a.ref}` }) },
  { name: "type", description: "Type text into an input by ref, e.g. @i1.", inputSchema: { type: "object", properties: { ref: { type: "string" }, text: { type: "string" } }, required: ["ref", "text"] }, build: (a) => ({ cmd: `type ${a.ref} ${a.text}` }) },
  { name: "fill", description: "Set the value of an input/select by ref, e.g. @i1.", inputSchema: { type: "object", properties: { ref: { type: "string" }, text: { type: "string" } }, required: ["ref", "text"] }, build: (a) => ({ cmd: `fill ${a.ref} ${a.text}` }) },
  { name: "select", description: "Choose an option in a <select> by ref and value, e.g. @i2 option-x.", inputSchema: { type: "object", properties: { ref: { type: "string" }, value: { type: "string" } }, required: ["ref", "value"] }, build: (a) => ({ cmd: `select ${a.ref} ${a.value}` }) },
  { name: "scroll", description: "Scroll. dir: up|down|left|right, optional px (default 300).", inputSchema: { type: "object", properties: { dir: { enum: ["up", "down", "left", "right"] }, px: { type: "number" } }, required: ["dir"] }, build: (a) => ({ cmd: `scroll ${a.dir}${a.px !== undefined ? ` ${a.px}` : ""}` }) },
  { name: "wait", description: "Wait for a condition: 'load', '<ms>' (e.g. 500), a CSS selector like '#btn', or a URL glob.", inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] }, build: (a) => ({ cmd: `wait ${a.target}` }) },
  { name: "get", description: "Return the text/state of a single element by ref, e.g. @e1.", inputSchema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] }, build: (a) => ({ cmd: `get ${a.ref}` }) },
  { name: "check", description: "Assert a rule against the live DOM. Rules: text=\"...\" (contains), exists=\"sel\", visible=\"sel\", count \"sel\" N. Returns {verdict,rule,actual}.", inputSchema: { type: "object", properties: { rule: { type: "string" } }, required: ["rule"] }, build: (a) => ({ cmd: `check ${a.rule}` }) },
  { name: "attach", description: "Attach/upload a file in the current page. Optional ref = the control that opens the picker (e.g. Gmail 'Attach files') — uses the native file chooser. Returns a JSON. For hidden inputs try without ref first.", inputSchema: { type: "object", properties: { file: { type: "string", description: "Absolute file path" }, ref: { type: "string", description: "Optional ref of the control that opens the file picker" } }, required: ["file"] }, build: (a) => ({ cmd: `attach ${a.file}${a.ref ? ` ${a.ref}` : ""}` }) },
  { name: "press", description: "Send a keyboard key: Enter, Tab, Escape, ArrowDown/Up/Left/Right, or a char. Optional ref focuses it first (e.g. confirm a combobox recipient: type email then press Enter).", inputSchema: { type: "object", properties: { key: { type: "string" }, ref: { type: "string" } }, required: ["key"] }, build: (a) => ({ cmd: a.ref ? `press ${a.ref} ${a.key}` : `press ${a.key}` }) },
  { name: "eval", description: "Run a JS expression in the page and return the value. One-liner only (no spaces) or pass ref-scoped form 'eval @e1 this.value'. For complex multi-line checks use batch with a file-read eval.", inputSchema: { type: "object", properties: { expr: { type: "string" }, ref: { type: "string" } }, required: ["expr"] }, build: (a) => ({ cmd: a.ref ? `eval ${a.ref} ${a.expr}` : `eval ${a.expr}` }) },
  { name: "shot", description: "Take a screenshot. Optional path; default writes and returns the saved path.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: [] }, build: (a) => ({ cmd: a.path ? `shot ${a.path}` : "shot" }) },
  { name: "batch", description: "Run several commands in one process, in order. Returns one result per command. Use to preserve state across one-shot steps.", inputSchema: { type: "object", properties: { commands: { type: "array", items: { type: "string" } } }, required: ["commands"] }, build: (a) => ({ commands: (a.commands as string[]).map((c) => String(c)) }) },
  { name: "skill", description: "Return the una skill document (protocol rules for agents).", inputSchema: { type: "object", properties: {}, required: [] }, build: () => ({ cmd: "skill" }) },
];

let daemon: Daemon | null = null;

async function ensureDaemon(): Promise<void> {
  const up = await fetch(`${healthUrl()}/healthz`).then((r) => r.ok).catch(() => false);
  if (!up) daemon = await startDaemon();
}

process.on("exit", () => { if (daemon) void stopDaemon(daemon); });

function reply(id: unknown, result: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function error(id: unknown, code: number, message: string) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

export async function main(): Promise<void> {
  const reader = Bun.stdin.stream().getReader();
  const textDecoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += textDecoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) void handle(JSON.parse(line));
      nl = buf.indexOf("\n");
    }
  }
}

async function handle(msg: { jsonrpc: string; id?: unknown; method?: string; params?: Record<string, unknown> }): Promise<void> {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      Bun.stdout.write(reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: NAME, version: VERSION } }) + "\n");
      return;
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "tools/list":
      Bun.stdout.write(reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }) + "\n");
      return;
    case "tools/call": {
      const name = String(params?.name ?? "");
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        Bun.stdout.write(error(id, -32602, `unknown tool '${name}'`) + "\n");
        return;
      }
      try {
        await ensureDaemon();
        const wire = tool.build(args);
        const res = await fetch(`${healthUrl()}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(wire) });
        const json = (await res.json()) as { ok: boolean; result?: unknown; error?: { code: string; message: string; hint?: string } };
        if (json.ok) {
          Bun.stdout.write(reply(id, { content: texts(JSON.stringify(json.result)).flat() }) + "\n");
        } else {
          const e = json.error!;
          Bun.stdout.write(reply(id, { content: texts(JSON.stringify({ error: e })).flat(), isError: true }) + "\n");
        }
      } catch (err) {
        Bun.stdout.write(error(id, -32603, err instanceof Error ? err.message : String(err)) + "\n");
      }
      return;
    }
    default:
      Bun.stdout.write(error(id, -32601, `method not found: ${method}`) + "\n");
  }
}

if (process.env.UNA_MCP_MAIN) await main();