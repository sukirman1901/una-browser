import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// scrypt N=32768, r=8, p=1 (~32 MiB); keep parameters versioned with the file format.
export function deriveKey(passphrase: string, salt: string): Buffer {
  if (!passphrase) throw new Error("master passphrase required");
  return scryptSync(passphrase, Buffer.from(salt, "base64"), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export interface Sealed { nonce: string; ciphertext: string; tag: string }

export function seal(key: Buffer, value: unknown, aad: string): Sealed {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function unseal<T>(key: Buffer, data: Sealed, aad: string): T {
  if (![data.nonce, data.ciphertext, data.tag].every((x) => typeof x === "string") ||
    Buffer.from(data.nonce, "base64").length !== 12 || Buffer.from(data.tag, "base64").length !== 16) {
    throw new Error("invalid vault ciphertext");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(data.nonce, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(data.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext, "base64")), decipher.final()]).toString("utf8")) as T;
}
