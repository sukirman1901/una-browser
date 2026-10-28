import { randomBytes, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { deriveKey, seal, unseal, type Sealed } from "./crypto";

const VERSION = 1;
export interface Credential { website: string; username: string; password: string; notes: string }
interface RecordEntry extends Sealed { id: string; website: string }
interface VaultFile { version: number; salt: string; check: Sealed; entries: RecordEntry[] }

function location(root: string): string {
  const dir = path.join(root, "vault");
  if (fs.existsSync(dir) && (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink())) throw new Error("unsafe vault directory");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if ((fs.statSync(dir).mode & 0o077) !== 0) throw new Error("unsafe vault permissions");
  return path.join(dir, "data.json");
}

function checkFile(file: string): void {
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || (fs.statSync(file).mode & 0o077) !== 0)) {
    throw new Error("unsafe vault file");
  }
}

export function canonicalWebsite(website: string): string {
  const url = new URL(website);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("website must be an HTTPS URL without credentials");
  return url.origin + "/";
}

function save(file: string, data: VaultFile): void {
  checkFile(file);
  const temp = path.join(path.dirname(file), `.data-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export class VaultStore {
  constructor(private readonly file: string, private readonly key: Buffer, private readonly data: VaultFile) {}

  list(): { id: string; website: string; username: string }[] {
    return this.data.entries.map((entry) => ({ id: entry.id, website: entry.website, username: this.get(entry.id).username }));
  }

  get(id: string): Credential {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) throw new Error("account not found");
    return { website: entry.website, ...unseal<Omit<Credential, "website">>(this.key, entry, `${VERSION}:${entry.website}:${entry.id}`) };
  }

  add(credential: Credential): string {
    const website = canonicalWebsite(credential.website);
    if (!credential.username || !credential.password) throw new Error("username and password required");
    if (this.data.entries.some((entry) => entry.website === website && this.get(entry.id).username === credential.username)) {
      throw new Error("account already exists");
    }
    const id = randomUUID();
    const entry = { id, website, ...seal(this.key, { username: credential.username, password: credential.password, notes: credential.notes }, `${VERSION}:${website}:${id}`) };
    const next = { ...this.data, entries: [...this.data.entries, entry] };
    save(this.file, next);
    this.data.entries = next.entries;
    return id;
  }

  update(id: string, credential: Credential): void {
    const index = this.data.entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error("account not found");
    const website = canonicalWebsite(credential.website);
    if (!credential.username || !credential.password) throw new Error("username and password required");
    if (this.data.entries.some((entry) => entry.id !== id && entry.website === website && this.get(entry.id).username === credential.username)) throw new Error("account already exists");
    const entry = { id, website, ...seal(this.key, { username: credential.username, password: credential.password, notes: credential.notes }, `${VERSION}:${website}:${id}`) };
    const next = { ...this.data, entries: this.data.entries.map((old, i) => i === index ? entry : old) };
    save(this.file, next);
    this.data.entries = next.entries;
  }

  delete(id: string): void {
    if (!this.data.entries.some((entry) => entry.id === id)) throw new Error("account not found");
    const next = { ...this.data, entries: this.data.entries.filter((entry) => entry.id !== id) };
    save(this.file, next);
    this.data.entries = next.entries;
  }

  lock(): void { this.key.fill(0); }
}

export function createVault(root: string, passphrase: string): VaultStore {
  const file = location(root);
  checkFile(file);
  if (fs.existsSync(file)) throw new Error("vault already exists");
  const salt = randomBytes(16).toString("base64");
  const key = deriveKey(passphrase, salt);
  const data: VaultFile = { version: VERSION, salt, check: seal(key, "una-vault-v1", `${VERSION}:check`), entries: [] };
  // Exclusive create prevents accidental replacement by concurrent initializers.
  fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600, flag: "wx" });
  return new VaultStore(file, key, data);
}

export function openVault(root: string, passphrase: string): VaultStore {
  const file = location(root);
  checkFile(file);
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as VaultFile;
  if (data?.version !== VERSION || typeof data.salt !== "string" || !Array.isArray(data.entries)) throw new Error("unsupported or invalid vault format");
  const key = deriveKey(passphrase, data.salt);
  try {
    if (unseal<string>(key, data.check, `${VERSION}:check`) !== "una-vault-v1") throw new Error("invalid vault");
    const vault = new VaultStore(file, key, data);
    for (const entry of data.entries) vault.get(entry.id);
    return vault;
  } catch {
    key.fill(0);
    throw new Error("incorrect passphrase or invalid vault data");
  }
}
