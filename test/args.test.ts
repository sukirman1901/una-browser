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
});