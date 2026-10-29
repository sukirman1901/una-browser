import { createVault, openVault, type Credential, type VaultStore } from "./store";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface VaultReader {
  isUnlocked(): boolean | Promise<boolean>;
  list(): ReturnType<VaultStore["list"]> | Promise<ReturnType<VaultStore["list"]>>;
  get(id: string): Credential | Promise<Credential>;
}

export class VaultManager {
  private store: VaultStore | null = null;
  private generation = 0;
  constructor(private readonly root: string) {}

  getGeneration(): number { return this.generation; }
  isUnlocked(): boolean { return this.store !== null; }
  exists(): boolean { return existsSync(join(this.root, "vault", "data.json")); }
  init(passphrase: string): void { this.store = createVault(this.root, passphrase); this.generation++; }
  unlock(passphrase: string): void {
    this.lock();
    this.store = openVault(this.root, passphrase);
  }
  lock(): void { this.store?.lock(); this.store = null; this.generation++; }
  list(): ReturnType<VaultStore["list"]> { return this.requireStore().list(); }
  add(credential: Credential): string { return this.requireStore().add(credential); }
  edit(id: string, credential: Credential): void { this.requireStore().update(id, credential); }
  delete(id: string): void { this.requireStore().delete(id); }
  get(id: string): Credential { return this.requireStore().get(id); }
  private requireStore(): VaultStore {
    if (!this.store) throw new Error("vault is locked");
    return this.store;
  }
}
