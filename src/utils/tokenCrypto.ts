import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";

// Symmetric encryption for secrets we must store and later REUSE (calendar
// OAuth refresh tokens) — unlike passwords, these can't be one-way hashed. We
// use AES-256-GCM, which is authenticated: tampering with the ciphertext fails
// the auth tag on decrypt instead of silently returning garbage.
//
// Storage format (single string, colon-separated, all base64):
//   v1:<iv>:<authTag>:<ciphertext>
// The version prefix lets us rotate the scheme later without guessing.

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12; // GCM standard nonce length

// Derive a fixed 32-byte key from ENCRYPTION_KEY so any length passphrase works.
const KEY = createHash("sha256").update(env.ENCRYPTION_KEY, "utf8").digest();

/** Encrypt a UTF-8 string into the versioned storage format. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypt a value produced by {@link encryptSecret}. Throws if tampered or malformed. */
export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("decryptSecret: unrecognized ciphertext format");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
