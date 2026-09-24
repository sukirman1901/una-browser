import { UnaError } from "./errors.ts";

export type Ref = string;

export interface SnapFlags {
  interactiveOnly: boolean;
  scopes: string[];
  urls: boolean;
  compact: boolean;
  depth: number;
}

export type Command =
  | { verb: "open"; url: string }
  | { verb: "snap"; interactiveOnly: boolean; scopes: string[]; urls: boolean; compact: boolean; depth: number }
  | { verb: "click"; ref: Ref }
  | { verb: "type"; ref: Ref; text: string }
  | { verb: "fill"; ref: Ref; text: string }
  | { verb: "select"; ref: Ref; value: string }
  | { verb: "scroll"; dir: "up" | "down" | "left" | "right"; px: number }
  | { verb: "wait"; target: string }
  | { verb: "get"; ref: Ref }
  | { verb: "check"; expect: string }
  | { verb: "shot"; path?: string }
  | { verb: "batch"; cmds: string[] }
  | { verb: "serve" }
  | { verb: "skill" };

const VERBS = new Set([
  "open", "snap", "click", "type", "fill", "select", "scroll",
  "wait", "get", "check", "shot", "batch", "serve", "skill",
]);

const REF_RE = /^@?e\d+$/;

function normalizeRef(s: string): Ref {
  if (!REF_RE.test(s)) throw new UnaError("grammar", `bad ref '${s}'`, "refs look like @e1 (from latest snapshot)");
  return s.startsWith("@") ? s : `@${s}`;
}

interface Tokenized {
  positionals: string[];
  flags: Record<string, string | true>;
}

function tokenize(argv: string[]): Tokenized {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  const takeValue = (i: number, name: string): { value: string; next: number } => {
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith("-") && v !== "-")) throw new UnaError("grammar", `flag ${name} requires a value`, `usage: ${name} <value>`);
    return { value: v, next: i + 1 };
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "-i" || t === "-u" || t === "-c" || t === "--json") { flags[t] = true; continue; }
    if (t === "-s" || t === "-d") { const { value, next } = takeValue(i, t); flags[t] = value; i = next; continue; }
    if (t.startsWith("-") && t !== "-") throw new UnaError("grammar", `unknown flag '${t}'`, "known flags: -i -u -c -s -d --json");
    positionals.push(t);
  }
  return { positionals, flags };
}

export function parseArgs(argv: string[]): Command {
  const args = argv.filter((a) => a !== "--json");
  const verb = args[0];
  if (!verb || !VERBS.has(verb)) {
    throw new UnaError("grammar", `unknown verb '${verb ?? ""}'`, `known verbs: ${[...VERBS].join(", ")}`);
  }
  const { positionals, flags } = tokenize(args.slice(1));

  switch (verb) {
    case "open": {
      const url = positionals[0];
      if (!url) throw new UnaError("grammar", "open requires a url", "usage: una open <url>");
      return { verb, url };
    }
    case "snap": {
      const depthFlag = flags["-d"];
      const depth = depthFlag === true ? 32 : Number(depthFlag ?? 32);
      return {
        verb, interactiveOnly: flags["-i"] === true, urls: flags["-u"] === true,
        compact: flags["-c"] === true,
        scopes: (flags["-s"] === true ? [] : String(flags["-s"] ?? "").split(",")).filter(Boolean),
        depth: Number.isFinite(depth) && depth >= 0 ? depth : 32,
      };
    }
    case "click": {
      const ref = positionals[0];
      if (!ref) throw new UnaError("grammar", "click requires a ref", "usage: una click @e1");
      return { verb, ref: normalizeRef(ref) };
    }
    case "type":
    case "fill": {
      const [ref, ...rest] = positionals;
      const text = rest.join(" ");
      if (!ref) throw new UnaError("grammar", `${verb} requires a ref`, `usage: una ${verb} @e1 <text>`);
      if (!text) throw new UnaError("grammar", `${verb} requires text`, `usage: una ${verb} @e1 <text>`);
      return { verb, ref: normalizeRef(ref), text } as Command;
    }
    case "select": {
      const ref = positionals[0];
      const value = positionals[1];
      if (!ref || value === undefined) throw new UnaError("grammar", "select requires ref and value", "usage: una select @e1 <value>");
      return { verb, ref: normalizeRef(ref), value };
    }
    case "scroll": {
      if (!["up", "down", "left", "right"].includes(positionals[0])) {
        throw new UnaError("grammar", "scroll requires dir up|down|left|right", "usage: una scroll down [px]");
      }
      const px = positionals[1] === undefined ? 300 : Number(positionals[1]);
      return { verb, dir: positionals[0] as "up" | "down" | "left" | "right", px };
    }
    case "wait": {
      const target = positionals[0];
      if (!target) throw new UnaError("grammar", "wait requires <ms|load|sel>", "usage: una wait load | una wait 500 | una wait #btn");
      return { verb, target };
    }
    case "get": {
      const ref = positionals[0];
      if (!ref) throw new UnaError("grammar", "get requires a ref", "usage: una get @e1");
      return { verb, ref: normalizeRef(ref) };
    }
    case "check": {
      const expect = positionals.join(" ");
      if (!expect) throw new UnaError("grammar", "check requires a rule", `usage: una check text="System One" | visible @e5 | count #row 3`);
      return { verb, expect };
    }
    case "shot": {
      return { verb, path: positionals[0] };
    }
    case "batch": {
      const json = positionals[0];
      if (!json) throw new UnaError("grammar", "batch requires a JSON array", 'usage: una batch \'["click @e1","get @e2"]\'');
      let arr: unknown;
      try { arr = JSON.parse(json); } catch { throw new UnaError("grammar", "batch json is not valid JSON", "usage: una batch '[...]'"); }
      if (!Array.isArray(arr) || arr.some((c) => typeof c !== "string")) {
        throw new UnaError("grammar", "batch must be an array of command strings", 'usage: una batch \'["verify"]\'');
      }
      return { verb, cmds: arr as string[] };
    }
    case "serve":
    case "skill":
      return { verb };
  }
  throw new UnaError("grammar", `unhandled verb '${verb}'`);
}