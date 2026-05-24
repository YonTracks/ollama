const ADMIN_AUTH_KEY = "ollama.app.admin.auth.v1";
const ADMIN_SESSION_KEY = "ollama.app.admin.session.v1";
const ADMIN_AUTH_VERSION = 1;
const ADMIN_AUTH_ITERATIONS = 210000;
const ADMIN_SESSION_TTL_MS = 15 * 60 * 1000;

export interface AdminAuthRecord {
  version: typeof ADMIN_AUTH_VERSION;
  algorithm: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  verifier: string;
  createdAt: string;
}

interface AdminSessionRecord {
  unlockedAt: number;
  expiresAt: number;
}

export function adminAuthConfigured(storage?: Storage) {
  return Boolean(readAdminAuthRecord(storage));
}

export function adminSessionActive(storage?: Storage, now = Date.now()) {
  const target = storage ?? browserSessionStorage();
  const raw = target.getItem(ADMIN_SESSION_KEY);
  if (!raw) return false;

  try {
    const session = JSON.parse(raw) as Partial<AdminSessionRecord>;
    if (typeof session.expiresAt !== "number" || session.expiresAt <= now) {
      target.removeItem(ADMIN_SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    target.removeItem(ADMIN_SESSION_KEY);
    return false;
  }
}

export async function setupAdminPassphrase(
  passphrase: string,
  authStorage?: Storage,
  sessionStorageOverride?: Storage
) {
  const record = await createAdminAuthRecord(passphrase);
  const target = authStorage ?? browserLocalStorage();
  target.setItem(ADMIN_AUTH_KEY, JSON.stringify(record));
  markAdminSession(sessionStorageOverride);
}

export async function verifyAdminPassphrase(
  passphrase: string,
  authStorage?: Storage,
  sessionStorageOverride?: Storage
) {
  const record = readAdminAuthRecord(authStorage);
  if (!record) {
    throw new Error("Admin login is not configured.");
  }

  const verified = await verifyAdminAuthRecord(passphrase, record);
  if (verified) {
    markAdminSession(sessionStorageOverride);
  }
  return verified;
}

export async function createAdminAuthRecord(passphrase: string): Promise<AdminAuthRecord> {
  const normalized = normalizePassphrase(passphrase);
  const salt = randomBytes(16);
  const verifier = await deriveVerifier(normalized, salt, ADMIN_AUTH_ITERATIONS);
  return {
    version: ADMIN_AUTH_VERSION,
    algorithm: "PBKDF2-SHA256",
    iterations: ADMIN_AUTH_ITERATIONS,
    salt: bytesToBase64(salt),
    verifier: bytesToBase64(verifier),
    createdAt: new Date().toISOString()
  };
}

export async function verifyAdminAuthRecord(passphrase: string, record: AdminAuthRecord) {
  const normalized = normalizePassphrase(passphrase);
  const verifier = await deriveVerifier(
    normalized,
    base64ToBytes(record.salt),
    record.iterations
  );
  return timingSafeEqual(verifier, base64ToBytes(record.verifier));
}

export function clearAdminSession(storage?: Storage) {
  const target = storage ?? browserSessionStorage();
  target.removeItem(ADMIN_SESSION_KEY);
}

export function resetAdminAuth(authStorage?: Storage, sessionStorageOverride?: Storage) {
  const target = authStorage ?? browserLocalStorage();
  target.removeItem(ADMIN_AUTH_KEY);
  clearAdminSession(sessionStorageOverride);
}

export function storedAdminAuthRecord(storage?: Storage) {
  return readAdminAuthRecord(storage);
}

function readAdminAuthRecord(storage?: Storage): AdminAuthRecord | null {
  const target = storage ?? browserLocalStorage();
  const raw = target.getItem(ADMIN_AUTH_KEY);
  if (!raw) return null;

  try {
    return parseAdminAuthRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseAdminAuthRecord(value: unknown): AdminAuthRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<AdminAuthRecord>;
  if (
    record.version !== ADMIN_AUTH_VERSION ||
    record.algorithm !== "PBKDF2-SHA256" ||
    typeof record.iterations !== "number" ||
    typeof record.salt !== "string" ||
    typeof record.verifier !== "string" ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }
  return record as AdminAuthRecord;
}

export function markAdminSession(storage?: Storage, now = Date.now()) {
  const target = storage ?? browserSessionStorage();
  const session: AdminSessionRecord = {
    unlockedAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_MS
  };
  target.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

function normalizePassphrase(passphrase: string) {
  const normalized = passphrase.trim();
  if (normalized.length < 8) {
    throw new Error("Use at least 8 characters for the admin passphrase.");
  }
  return normalized;
}

async function deriveVerifier(passphrase: string, salt: Uint8Array, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bufferSource(salt),
      iterations
    },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
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

function bufferSource(bytes: Uint8Array): BufferSource {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function browserLocalStorage() {
  if (typeof localStorage === "undefined") {
    throw new Error("Admin login requires browser storage.");
  }
  return localStorage;
}

function browserSessionStorage() {
  if (typeof sessionStorage === "undefined") {
    throw new Error("Admin login requires browser session storage.");
  }
  return sessionStorage;
}
