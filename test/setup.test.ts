import { describe, expect, it } from "bun:test";
import { patchConfig } from "../src/mcp/setup";

describe("patchConfig", () => {
  it("adds una-mcp to a config without it", () => {
    const out = patchConfig(JSON.stringify({ $schema: "x", mcp: { smoke: {} } }), "/repo", "bun");
    const json = JSON.parse(out);
    expect(json.mcp["una-mcp"]).toEqual({ type: "local", command: ["bun", "src/mcp/server.ts"], cwd: "/repo", environment: { UNA_MCP_MAIN: "1" } });
    expect(json.mcp.smoke).toBeDefined();
    expect(out.endsWith("\n")).toBe(true);
  });

  it("creates mcp section if absent", () => {
    const out = patchConfig(JSON.stringify({}), "/repo", "/usr/bin/bun");
    expect(JSON.parse(out).mcp["una-mcp"]).toBeDefined();
  });

  it("is idempotent — leaves existing una-mcp untouched", () => {
    const raw = JSON.stringify({ mcp: { "una-mcp": { type: "local", command: ["old"], cwd: "/old" } } });
    expect(patchConfig(raw, "/repo", "bun")).toBe(raw);
  });
});