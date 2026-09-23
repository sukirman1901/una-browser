import { describe, expect, it } from "bun:test";
import { parseArgs } from "../src/args";

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
});