import { createVault, openVault, type Credential, type VaultStore } from "./store";

export class VaultManager {
  private store: VaultStore | null = null;
  constructor(private readonly root: string) {}

  isUnlocked(): boolean { return this.store !== null; }
  init(passphrase: string): void { this.store = createVault(this.root, passphrase); }
  unlock(passphrase: string): void {
    this.lock();
    this.store = openVault(this.root, passphrase);
  }
  lock(): void { this.store?.lock(); this.store = null; }
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
