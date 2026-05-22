const TOKEN_VAULT_KEY = "ollama.app.standalone.core-token.v1";
const BROWSER_TOKEN_KEY = "ollama.app.standalone.core-token.browser.v1";
const TOKEN_VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 210000;

export interface EncryptedTokenRecord {
  version: 1;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}

export interface BrowserTokenRecord {
  version: 1;
  storage: "browser";
  token: string;
  createdAt: string;
}

export function supportsEncryptedTokenStorage() {
  return Boolean(
    globalThis.crypto?.subtle && typeof globalThis.crypto?.getRandomValues === "function"
  );
}

export function encryptedCoreApiTokenExists(storage: Storage = localStorage) {
  return Boolean(storage.getItem(TOKEN_VAULT_KEY));
}

export function browserCoreApiTokenExists(storage: Storage = localStorage) {
  return Boolean(readBrowserCoreApiTokenRecord(storage));
}

export function readBrowserCoreApiTokenRecord(
  storage: Storage = localStorage
): BrowserTokenRecord | null {
  const raw = storage.getItem(BROWSER_TOKEN_KEY);
  if (!raw) return null;

  try {
    const record = JSON.parse(raw) as BrowserTokenRecord;
    if (
      record.version !== TOKEN_VAULT_VERSION ||
      record.storage !== "browser" ||
      typeof record.token !== "string"
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function readEncryptedCoreApiTokenRecord(
  storage: Storage = localStorage
): EncryptedTokenRecord | null {
  const raw = storage.getItem(TOKEN_VAULT_KEY);
  if (!raw) return null;

  try {
    const record = JSON.parse(raw) as EncryptedTokenRecord;
    if (
      record.version !== TOKEN_VAULT_VERSION ||
      record.algorithm !== "AES-GCM" ||
      record.kdf !== "PBKDF2-SHA256" ||
      typeof record.salt !== "string" ||
      typeof record.iv !== "string" ||
      typeof record.ciphertext !== "string"
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export async function saveEncryptedCoreApiToken(
  token: string,
  passphrase: string,
  storage: Storage = localStorage
) {
  const trimmedToken = token.trim();
  const trimmedPassphrase = passphrase.trim();
  if (!trimmedToken) throw new Error("Enter a token before remembering it.");
  if (!trimmedPassphrase) throw new Error("Enter a passphrase to encrypt the token.");
  ensureTokenCrypto();

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveTokenKey(trimmedPassphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(iv) },
    key,
    bufferSource(new TextEncoder().encode(trimmedToken))
  );

  const record: EncryptedTokenRecord = {
    version: TOKEN_VAULT_VERSION,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString()
  };
  storage.setItem(TOKEN_VAULT_KEY, JSON.stringify(record));

  if (!readEncryptedCoreApiTokenRecord(storage)) {
    throw new Error("Encrypted token was not saved. Check browser storage permissions.");
  }
}

export function saveBrowserCoreApiToken(token: string, storage: Storage = localStorage) {
  const trimmedToken = token.trim();
  if (!trimmedToken) throw new Error("Enter a token before remembering it.");

  const record: BrowserTokenRecord = {
    version: TOKEN_VAULT_VERSION,
    storage: "browser",
    token: trimmedToken,
    createdAt: new Date().toISOString()
  };
  storage.setItem(BROWSER_TOKEN_KEY, JSON.stringify(record));

  if (!readBrowserCoreApiTokenRecord(storage)) {
    throw new Error("Token was not saved. Check browser storage permissions.");
  }
}

export function loadBrowserCoreApiToken(storage: Storage = localStorage) {
  return readBrowserCoreApiTokenRecord(storage)?.token ?? "";
}

export async function loadEncryptedCoreApiToken(
  passphrase: string,
  storage: Storage = localStorage
) {
  const trimmedPassphrase = passphrase.trim();
  if (!trimmedPassphrase) throw new Error("Enter the passphrase to unlock the token.");
  ensureTokenCrypto();

  const record = readEncryptedCoreApiTokenRecord(storage);
  if (!record) throw new Error("No encrypted token is saved in this browser.");

  try {
    const salt = base64ToBytes(record.salt);
    const iv = base64ToBytes(record.iv);
    const key = await deriveTokenKey(trimmedPassphrase, salt, record.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bufferSource(iv) },
      key,
      bufferSource(base64ToBytes(record.ciphertext))
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Could not unlock the saved token. Check the passphrase.");
  }
}

export function clearEncryptedCoreApiToken(storage: Storage = localStorage) {
  storage.removeItem(TOKEN_VAULT_KEY);
}

export function clearBrowserCoreApiToken(storage: Storage = localStorage) {
  storage.removeItem(BROWSER_TOKEN_KEY);
}

function ensureTokenCrypto() {
  if (!supportsEncryptedTokenStorage()) {
    throw new Error("Encrypted token storage is not supported in this browser.");
  }
}

async function deriveTokenKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS
) {
  const material = await crypto.subtle.importKey(
    "raw",
    bufferSource(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: bufferSource(salt),
      iterations,
      hash: "SHA-256"
    },
    material,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
