import { UnaError } from "./errors.ts";

export type Ref = string;

export interface SnapFlags {
  interactiveOnly: boolean;
  scopes: string[];
  urls: boolean;
  compact: boolean;
  depth: number;
}

export type HarnessMode = "headless" | "headed" | `attach:${number}`;

export type Command =
  | { verb: "open"; url: string; }
  | { verb: "snap"; interactiveOnly: boolean; scopes: string[]; urls: boolean; compact: boolean; depth: number }
  | { verb: "click"; ref: Ref }
  | { verb: "type"; ref: Ref; text: string }
  | { verb: "fill"; ref: Ref; text: string }
  | { verb: "select"; ref: Ref; value: string }
  | { verb: "attach"; file: string; ref?: Ref }
  | { verb: "press"; ref?: Ref; key: string }
  | { verb: "eval"; expr: string; ref?: Ref }
  | { verb: "scroll"; dir: "up" | "down" | "left" | "right"; px: number }
  | { verb: "wait"; target: string; timeout?: number }
  | { verb: "get"; ref: Ref }
  | { verb: "check"; expect: string }
  | { verb: "shot"; path?: string }
  | { verb: "batch"; cmds: string[] }
  | { verb: "serve"; id?: string; mode?: HarnessMode; route?: string; browser?: "chrome" | "chromium" }
  | { verb: "skill" };

const VERBS = new Set([
  "open", "snap", "click", "type", "fill", "select", "scroll",
  "wait", "get", "check", "shot", "batch", "serve", "skill", "attach",
  "press", "eval",
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

const VALUE_FLAGS = new Set(["-s", "-d", "--id", "--mode", "--route", "--browser", "--timeout"]);
const BOOL_FLAGS = new Set(["-i", "-u", "-c", "--json"]);

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
    if (BOOL_FLAGS.has(t)) { flags[t] = true; continue; }
    if (VALUE_FLAGS.has(t)) { const { value, next } = takeValue(i, t); flags[t] = value; i = next; continue; }
    if (t.startsWith("-") && t !== "-") throw new UnaError("grammar", `unknown flag '${t}'`, "known flags: -i -u -c -s -d --id --mode --route --browser --timeout --json");
    positionals.push(t);
  }
  return { positionals, flags };
}

export function flagValue(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) if (argv[i] === name) return argv[i + 1];
  return undefined;
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
    case "attach": {
      const file = positionals[0];
      const ref = positionals[1];
      if (!file) throw new UnaError("grammar", "attach requires a file path", "usage: una attach <file> [ref]");
      return { verb, file, ref: ref ? normalizeRef(ref) : undefined };
    }
    case "press": {
      const [refOrKey, maybeKey] = positionals;
      if (!refOrKey) throw new UnaError("grammar", "press requires a key", "usage: una press Enter | una press @e1 Enter");
      if (maybeKey) return { verb, ref: normalizeRef(refOrKey), key: maybeKey };
      return { verb, key: refOrKey };
    }
    case "eval": {
      if (positionals.length === 0) throw new UnaError("grammar", "eval requires a JS expression", "usage: una eval 'document.title'");
      if (positionals.length === 2) return { verb, ref: normalizeRef(positionals[0]), expr: positionals[1] };
      return { verb, expr: positionals.join(" ") };
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
      if (!target) throw new UnaError("grammar", "wait requires <ms|load|sel|resolve>", "usage: una wait load | una wait 500 | una wait #btn | una wait resolve [--timeout 15000]");
      const ms = flags["--timeout"];
      const timeout = ms === true || ms === undefined ? undefined : Number(ms);
      return { verb, target, timeout: Number.isFinite(timeout as number) ? (timeout as number) : undefined };
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
    case "serve": {
      const id = typeof flags["--id"] === "string" ? (flags["--id"] as string) : undefined;
      const mode = typeof flags["--mode"] === "string" ? (flags["--mode"] as string) : undefined;
      const route = typeof flags["--route"] === "string" ? (flags["--route"] as string) : undefined;
      const browser = typeof flags["--browser"] === "string" ? (flags["--browser"] as string) : undefined;
      if (id !== undefined && !/^[a-zA-Z0-9._-]+$/.test(id)) throw new UnaError("grammar", `bad identity '${id}'`, "identities match [a-zA-Z0-9._-]");
      if (mode !== undefined && !(mode === "headless" || mode === "headed" || mode.startsWith("attach:"))) {
        throw new UnaError("grammar", `bad --mode '${mode}'`, "modes: headless | headed | attach[:port]");
      }
      if (browser !== undefined && !(browser === "chrome" || browser === "chromium")) {
        throw new UnaError("grammar", `bad --browser '${browser}'`, "browsers: chrome | chromium");
      }
      return { verb, id, mode: mode as HarnessMode | undefined, route, browser: browser as "chrome" | "chromium" | undefined };
    }
    case "skill":
      return { verb };
  }
  throw new UnaError("grammar", `unhandled verb '${verb}'`);
}