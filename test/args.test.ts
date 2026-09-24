import { describe, expect, it } from "bun:test";
import { flagValue, parseArgs } from "../src/args";
import { UnaError } from "../src/errors";

describe("args closed grammar", () => {
  it("parses simple verbs", () => {
    expect(parseArgs(["open", "https://x.dev"])).toEqual({ verb: "open", url: "https://x.dev" });
  });

  it("unknown verb → grammar error", () => {
    expect(() => parseArgs(["frobnicate"])).toThrow("unknown verb");
  });

  it("refs may be @e1 or e1 → normalized to @e1", () => {
    expect(parseArgs(["click", "e1"])).toEqual({ verb: "click", ref: "@e1" });
    expect(parseArgs(["click", "@e1"])).toEqual({ verb: "click", ref: "@e1" });
  });

  it("snap flags: -i -c -d 5 -s main,nav", () => {
    expect(parseArgs(["snap", "-i", "-c", "-d", "5", "-s", "main,nav"]))
      .toEqual({ verb: "snap", interactiveOnly: true, scopes: ["main", "nav"], urls: false, compact: true, depth: 5 });
  });

  it("unknown flag → grammar error", () => {
    expect(() => parseArgs(["snap", "-z"])).toThrow("unknown flag");
  });

  it("fill/type require positionals", () => {
    expect(() => parseArgs(["fill", "@e1"])).toThrow("text");
    expect(parseArgs(["fill", "@e1", "Rudi"])).toEqual({ verb: "fill", ref: "@e1", text: "Rudi" });
  });

  it("batch parses JSON array", () => {
    expect(parseArgs(["batch", '["click @e1","get @e2"]']))
      .toEqual({ verb: "batch", cmds: ["click @e1", "get @e2"] });
  });

  it("scroll requires valid dir", () => {
    expect(() => parseArgs(["scroll", "diagonal"])).toThrow("dir");
  });

  it("--json may lead the verb", () => {
    expect(parseArgs(["--json", "snap", "-i"])).toEqual({
      verb: "snap", interactiveOnly: true, scopes: [], urls: false, compact: false, depth: 32,
    });
  });

  it("scroll px defaults to 300, honors explicit 0", () => {
    expect(parseArgs(["scroll", "down"])).toEqual({ verb: "scroll", dir: "down", px: 300 });
    expect(parseArgs(["scroll", "down", "0"])).toEqual({ verb: "scroll", dir: "down", px: 0 });
  });

  it("select requires ref and value", () => {
    expect(() => parseArgs(["select", "@e1"])).toThrow("value");
    expect(parseArgs(["select", "@e1", "id-2"])).toEqual({ verb: "select", ref: "@e1", value: "id-2" });
  });

  it("type joins multi-word text", () => {
    expect(parseArgs(["type", "@e3", "Halo", "dunia"])).toEqual({ verb: "type", ref: "@e3", text: "Halo dunia" });
  });

  it("shot keeps optional path", () => {
    expect(parseArgs(["shot"])).toEqual({ verb: "shot", path: undefined });
    expect(parseArgs(["shot", "/tmp/x.png"])).toEqual({ verb: "shot", path: "/tmp/x.png" });
  });

  it("flag missing value / swallowing next flag → grammar error", () => {
    expect(() => parseArgs(["snap", "-d"])).toThrow("requires a value");
    expect(() => parseArgs(["snap", "-d", "-i"])).toThrow("requires a value");
  });

  it("serve parses --id/--mode/--route/--browser", () => {
    const c = parseArgs(["serve", "--id", "work", "--mode", "headed", "--route", "us1", "--browser", "chromium"]);
    expect(c).toEqual({ verb: "serve", id: "work", mode: "headed", route: "us1", browser: "chromium" });
  });

  it("bare serve leaves identity fields undefined (no 'undefined' strings)", () => {
    const c = parseArgs(["serve"]);
    expect(c).toEqual({ verb: "serve", id: undefined, mode: undefined, route: undefined, browser: undefined });
  });

  it("serve rejects invalid --mode", () => {
    expect(() => parseArgs(["serve", "--mode", "stealthy"])).toThrow();
  });

  it("wait resolve parses with --timeout", () => {
    const c = parseArgs(["wait", "resolve", "--timeout", "15000"]);
    expect(c).toMatchObject({ verb: "wait", target: "resolve", timeout: 15000 });
  });

  it("other verbs tolerate a leading --id (transport flag)", () => {
    const c = parseArgs(["open", "https://example.com", "--id", "work"]);
    expect(c).toMatchObject({ verb: "open", url: "https://example.com" });
  });

  it("flagValue extracts a named flag value", () => {
    expect(flagValue(["open", "x", "--id", "work"], "--id")).toBe("work");
    expect(flagValue(["open"], "--route")).toBeUndefined();
  });
});
describe("attach / press / eval verbs", () => {
  it("attach parses file and optional ref", () => {
    expect(parseArgs(["attach", "/tmp/a.png"])).toEqual({ verb: "attach", file: "/tmp/a.png", ref: undefined });
    expect(parseArgs(["attach", "/tmp/a.png", "@e5"])).toEqual({ verb: "attach", file: "/tmp/a.png", ref: "@e5" });
    expect(parseArgs(["attach", "/tmp/a.png", "e5"])).toEqual({ verb: "attach", file: "/tmp/a.png", ref: "@e5" });
  });

  it("attach rejects missing file → grammar error", () => {
    expect(() => parseArgs(["attach"])).toThrow("attach requires a file path");
  });

  it("press parses bare key and ref+key", () => {
    expect(parseArgs(["press", "Enter"])).toEqual({ verb: "press", ref: undefined, key: "Enter" });
    expect(parseArgs(["press", "@e3", "Tab"])).toEqual({ verb: "press", ref: "@e3", key: "Tab" });
    expect(parseArgs(["press", "e3", "Escape"])).toEqual({ verb: "press", ref: "@e3", key: "Escape" });
  });

  it("press rejects missing key → grammar error", () => {
    expect(() => parseArgs(["press"])).toThrow("press requires a key");
  });

  it("eval joins expression tokens", () => {
    expect(parseArgs(["eval", "document.title"])).toEqual({ verb: "eval", ref: undefined, expr: "document.title" });
    expect(parseArgs(["eval", "document.querySelector('p').textContent"])).toEqual({ verb: "eval", ref: undefined, expr: "document.querySelector('p').textContent" });
    expect(parseArgs(["eval", "@e2", "this.value"])).toEqual({ verb: "eval", ref: "@e2", expr: "this.value" });
  });

  it("eval rejects missing expression → grammar error", () => {
    expect(() => parseArgs(["eval"])).toThrow("eval requires a JS expression");
  });
});

describe("tab / tabs / switch / close / parallel verbs", () => {
  it("tab requires a url", () => {
    expect(parseArgs(["tab", "https://x.dev"])).toEqual({ verb: "tab", url: "https://x.dev" });
    expect(() => parseArgs(["tab"])).toThrow("tab requires a url");
  });

  it("tabs has no positionals", () => {
    expect(parseArgs(["tabs"])).toEqual({ verb: "tabs" });
  });

  it("switch keeps target as opaque string (index or url-prefix)", () => {
    expect(parseArgs(["switch", "0"])).toEqual({ verb: "switch", target: "0" });
    expect(parseArgs(["switch", "example.com"])).toEqual({ verb: "switch", target: "example.com" });
    expect(() => parseArgs(["switch"])).toThrow("switch requires");
  });

  it("close requires a numeric index", () => {
    expect(parseArgs(["close", "2"])).toEqual({ verb: "close", index: 2 });
    expect(() => parseArgs(["close", "abc"])).toThrow("close requires");
    expect(() => parseArgs(["close", "-1"])).toThrow();
    expect(() => parseArgs(["close"])).toThrow("close requires");
  });

  it("parallel parses {urls:[...],js} into per-url jobs", () => {
    const c = parseArgs(["parallel", '{"urls":["https://a.dev","https://b.dev"],"js":"() => document.title"}']);
    expect(c).toEqual({
      verb: "parallel",
      jobs: [
        { url: "https://a.dev", js: "() => document.title" },
        { url: "https://b.dev", js: "() => document.title" },
      ],
    });
  });

  it("parallel parses a bare job array and string array", () => {
    expect(parseArgs(["parallel", '[{"url":"https://a.dev","js":"document.title"}]']))
      .toEqual({ verb: "parallel", jobs: [{ url: "https://a.dev", js: "document.title" }] });
    expect(parseArgs(["parallel", '["https://a.dev","https://b.dev"]']))
      .toEqual({ verb: "parallel", jobs: [{ url: "https://a.dev" }, { url: "https://b.dev" }] });
  });

  it("parallel rejects bad JSON, empty, missing and overflow", () => {
    expect(() => parseArgs(["parallel", "{not json"])).toThrow("not valid JSON");
    expect(() => parseArgs(["parallel"])).toThrow("parallel requires");
    expect(() => parseArgs(["parallel", "{}"])).toThrow("urls");
    expect(() => parseArgs(["parallel", "[]"])).toThrow("no jobs");
    expect(() => parseArgs(["parallel", '{ "urls": [1] }'])).toThrow("url strings");
    const tooMany = Array.from({ length: 9 }, (_, i) => `"https://${i}.dev"`).join(",");
    expect(() => parseArgs(["parallel", `[${tooMany}]`])).toThrow("max 8 jobs");
  });
});

describe("fuse grammar", () => {
  it("parses a fuse array into command strings", () => {
    const c = parseArgs(["fuse", '["click @e1","get @e2"]']);
    expect(c.verb).toBe("fuse");
    expect((c as { cmds: string[] }).cmds).toEqual(["click @e1", "get @e2"]);
  });

  it("fuse requires an array of strings", () => {
    expect(() => parseArgs(["fuse", "click @e1"])).toThrow(UnaError);
    expect(() => parseArgs(["fuse", '["click @e1", 3]'])).toThrow(UnaError);
  });
});
