import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const REPO = resolve(import.meta.dirname, "../..");

function repoDir(argv: string[]): string {
  const i = argv.indexOf("--repo");
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1]);
  return REPO;
}

export function patchConfig(raw: string, repo: string, runner: string): string {
  const json = JSON.parse(raw) as Record<string, unknown>;
  const mcp = (json.mcp ?? {}) as Record<string, unknown>;
  if (mcp["una"]) return raw;
  mcp["una"] = {
    type: "local",
    command: [runner, "src/mcp/server.ts"],
    cwd: repo,
    environment: { UNA_MCP_MAIN: "1" },
  };
  delete mcp["una-mcp"];
  json.mcp = mcp;
  return `${JSON.stringify(json, null, 2)}\n`;
}

function run(cmd: string, args: string[], cwd: string): boolean {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd });
  return r.status === 0;
}

function findConfig(root: string, argv: string[]): string | null {
  const explicit = argv.indexOf("--config");
  if (explicit >= 0 && argv[explicit + 1]) return argv[explicit + 1];
  const candidates = [
    join(root, "opencode.json"),
    join(root, ".opencode/opencode.json"),
    join(homedir(), ".config/opencode/opencode.json"),
    join(homedir(), ".config/opencode/opencode.jsonc"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function install(repo: string): Promise<void> {
  console.log(`▶ installing dev deps (${repo})...`);
  run("bun", ["install"], repo);

  console.log("▶ linking global `una` command...");
  if (run("bun", ["link"], repo)) {
    console.log("✓ `una` tersedia; cek: una");
  } else {
    console.log("⚠ gagal link — coba manual: cd <repo> && bun link");
  }
}

async function patchMcp(root: string, argv: string[]): Promise<void> {
  const cfgPath = findConfig(root, argv);
  if (!cfgPath) {
    console.log("⚠ opencode.json tidak ditemukan.\n  Tambahkan manual sesuai README bagian MCP, atau:\n  bun src/mcp/setup.ts --config \"/path/ke/opencode.json\"");
    return;
  }
  const raw = await readFile(cfgPath, "utf8");
  let out: string;
  try {
    out = patchConfig(raw, repoDir(argv), process.execPath || "bun");
  } catch {
    console.log("⚠ config bukan JSON valid — biarkan, tambah manual.");
    return;
  }
  if (out === raw) {
    console.log(`✓ una sudah terdaftar di ${cfgPath}`);
    return;
  }
  await writeFile(cfgPath, out);
  console.log(`✓ una ditambahkan ke ${cfgPath}`);
  console.log("  Quit & restart opencode agar tool muncul (una_open, una_snap, ...).");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const repo = repoDir(argv);
  if (argv.includes("--install-only")) return install(repo);
  if (argv.includes("--mcp-only") || argv.includes("mcp")) {
    await install(repo);
    await patchMcp(process.cwd(), argv);
    return;
  }
  await install(repo);
  await patchMcp(process.cwd(), argv);
}

if (import.meta.main) await main();