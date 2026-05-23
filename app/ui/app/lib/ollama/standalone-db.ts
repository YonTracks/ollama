import type { Chat, ChatInfo, ChatMessage, ChatResponse, ChatsResponse } from "./types";

const DB_NAME = "ollama-app-standalone";
const DB_VERSION = 1;
const CHAT_STORE = "chats";
const CHAT_ENCRYPTION_KEY = "ollama.app.standalone.chat-encryption.v1";
const CHAT_ENCRYPTION_BROWSER_KEY = "ollama.app.standalone.chat-encryption.browser-key.v1";
const CHAT_ENCRYPTION_VERSION = 1;
const CHAT_ENCRYPTION_SENTINEL = "ollama standalone chat encryption";
const CHAT_ENCRYPTION_ITERATIONS = 210000;

interface StandaloneChatRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

interface EncryptedStandaloneChatRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  encrypted: true;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
}

type StoredStandaloneChatRecord = StandaloneChatRecord | EncryptedStandaloneChatRecord;

interface StandaloneChatEncryptionRecord {
  version: 1;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}

interface BrowserChatEncryptionKeyRecord {
  version: 1;
  storage: "browser";
  algorithm: "AES-GCM";
  key: string;
  createdAt: string;
}

let standaloneChatEncryptionKey: CryptoKey | null = null;
let standaloneChatEncryptionKeyBytes: Uint8Array | null = null;

function ensureIndexedDb() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this browser.");
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function openStandaloneDb(): Promise<IDBDatabase> {
  ensureIndexedDb();

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHAT_STORE)) {
        const store = db.createObjectStore(CHAT_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open standalone chat storage."));
  });
}

async function withChatStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  const db = await openStandaloneDb();
  try {
    const transaction = db.transaction(CHAT_STORE, mode);
    const store = transaction.objectStore(CHAT_STORE);
    const result = callback(store);

    if (result instanceof IDBRequest) {
      const value = await requestToPromise(result);
      await transactionDone(transaction);
      return value;
    }

    const value = await result;
    await transactionDone(transaction);
    return value;
  } finally {
    db.close();
  }
}

export function supportsStandaloneChatEncryption() {
  return Boolean(
    globalThis.crypto?.subtle &&
      typeof globalThis.crypto?.getRandomValues === "function" &&
      typeof localStorage !== "undefined"
  );
}

export function standaloneChatEncryptionConfigured(storage?: Storage) {
  return Boolean(readChatEncryptionRecord(storage));
}

export function standaloneChatEncryptionUnlocked() {
  return Boolean(standaloneChatEncryptionKey);
}

export function standaloneChatEncryptionRemembered(storage?: Storage) {
  return Boolean(readBrowserChatEncryptionKeyRecord(storage));
}

export async function enableStandaloneChatEncryption(
  passphrase: string,
  storage?: Storage
) {
  const trimmedPassphrase = passphrase.trim();
  if (!trimmedPassphrase) throw new Error("Enter a passphrase to encrypt browser chats.");
  ensureStandaloneChatCrypto();
  if (standaloneChatEncryptionConfigured(storage)) {
    throw new Error("Browser chat encryption is already enabled.");
  }

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const keyBytes = await deriveStandaloneChatKeyBytes(trimmedPassphrase, salt);
  const key = await importStandaloneChatKey(keyBytes);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(iv) },
    key,
    bufferSource(new TextEncoder().encode(CHAT_ENCRYPTION_SENTINEL))
  );

  const record: StandaloneChatEncryptionRecord = {
    version: CHAT_ENCRYPTION_VERSION,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: CHAT_ENCRYPTION_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString()
  };

  standaloneChatEncryptionKey = key;
  standaloneChatEncryptionKeyBytes = keyBytes;
  const targetStorage = getBrowserStorage(storage);
  if (!targetStorage) throw new Error("Browser storage is not available.");

  targetStorage.setItem(CHAT_ENCRYPTION_KEY, JSON.stringify(record));
  await rewriteStandaloneChatsForEncryption(true);
}

export async function unlockStandaloneChatEncryption(
  passphrase: string,
  storage?: Storage
) {
  const trimmedPassphrase = passphrase.trim();
  if (!trimmedPassphrase) throw new Error("Enter the passphrase to unlock browser chats.");
  ensureStandaloneChatCrypto();

  const record = readChatEncryptionRecord(storage);
  if (!record) throw new Error("Browser chat encryption is not enabled.");

  try {
    const salt = base64ToBytes(record.salt);
    const iv = base64ToBytes(record.iv);
    const keyBytes = await deriveStandaloneChatKeyBytes(trimmedPassphrase, salt, record.iterations);
    const key = await importStandaloneChatKey(keyBytes);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bufferSource(iv) },
      key,
      bufferSource(base64ToBytes(record.ciphertext))
    );
    if (new TextDecoder().decode(plaintext) !== CHAT_ENCRYPTION_SENTINEL) {
      throw new Error("invalid sentinel");
    }
    standaloneChatEncryptionKey = key;
    standaloneChatEncryptionKeyBytes = keyBytes;
  } catch {
    throw new Error("Could not unlock browser chats. Check the passphrase.");
  }
}

export async function rememberStandaloneChatEncryption(storage?: Storage) {
  ensureStandaloneChatCrypto();
  if (!standaloneChatEncryptionConfigured(storage)) {
    throw new Error("Browser chat encryption is not enabled.");
  }
  if (!standaloneChatEncryptionKey || !standaloneChatEncryptionKeyBytes) {
    throw new Error("Unlock browser chat encryption before remembering it.");
  }

  const targetStorage = getBrowserStorage(storage);
  if (!targetStorage) throw new Error("Browser storage is not available.");

  const record: BrowserChatEncryptionKeyRecord = {
    version: CHAT_ENCRYPTION_VERSION,
    storage: "browser",
    algorithm: "AES-GCM",
    key: bytesToBase64(standaloneChatEncryptionKeyBytes),
    createdAt: new Date().toISOString()
  };
  targetStorage.setItem(CHAT_ENCRYPTION_BROWSER_KEY, JSON.stringify(record));

  if (!readBrowserChatEncryptionKeyRecord(storage)) {
    throw new Error("Browser chat unlock key was not saved. Check browser storage permissions.");
  }
}

export function forgetRememberedStandaloneChatEncryption(storage?: Storage) {
  getBrowserStorage(storage)?.removeItem(CHAT_ENCRYPTION_BROWSER_KEY);
}

export async function restoreRememberedStandaloneChatEncryption(storage?: Storage) {
  if (standaloneChatEncryptionKey) return true;

  const encryptionRecord = readChatEncryptionRecord(storage);
  const browserKeyRecord = readBrowserChatEncryptionKeyRecord(storage);
  if (!encryptionRecord || !browserKeyRecord) return false;
  ensureStandaloneChatCrypto();

  try {
    const keyBytes = base64ToBytes(browserKeyRecord.key);
    const key = await importStandaloneChatKey(keyBytes);
    await validateStandaloneChatKey(key, encryptionRecord);
    standaloneChatEncryptionKey = key;
    standaloneChatEncryptionKeyBytes = keyBytes;
    return true;
  } catch {
    return false;
  }
}

export async function disableStandaloneChatEncryption(storage?: Storage) {
  await restoreRememberedStandaloneChatEncryption(storage);
  if (standaloneChatEncryptionConfigured(storage) && !standaloneChatEncryptionKey) {
    throw new Error("Unlock browser chat encryption before turning it off.");
  }

  await rewriteStandaloneChatsForEncryption(false);
  standaloneChatEncryptionKey = null;
  standaloneChatEncryptionKeyBytes = null;
  forgetRememberedStandaloneChatEncryption(storage);
  getBrowserStorage(storage)?.removeItem(CHAT_ENCRYPTION_KEY);
}

export function lockStandaloneChatEncryption() {
  standaloneChatEncryptionKey = null;
  standaloneChatEncryptionKeyBytes = null;
}

function nowIso() {
  return new Date().toISOString();
}

function titleFromMessages(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const title = firstUserMessage?.content.trim().replace(/\s+/g, " ");
  if (!title && firstUserMessage?.attachments?.length) {
    const firstAttachment = firstUserMessage.attachments[0];
    const suffix =
      firstUserMessage.attachments.length > 1
        ? ` +${firstUserMessage.attachments.length - 1}`
        : "";
    const attachmentTitle = `${firstAttachment.name}${suffix}`;
    return attachmentTitle.length > 64
      ? `${attachmentTitle.slice(0, 61)}...`
      : attachmentTitle;
  }
  if (!title) return "New chat";
  return title.length > 64 ? `${title.slice(0, 61)}...` : title;
}

function excerptFromMessages(messages: ChatMessage[]) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const excerpt = lastUserMessage?.content.trim().replace(/\s+/g, " ");
  if (excerpt) return excerpt.slice(0, 120);

  const attachmentCount = lastUserMessage?.attachments?.length ?? 0;
  if (attachmentCount === 0) return "";
  return attachmentCount === 1
    ? `Attached ${lastUserMessage?.attachments?.[0]?.name ?? "file"}`
    : `Attached ${attachmentCount} files`;
}

function toRecord(chat: Chat): StandaloneChatRecord {
  const timestamp = nowIso();
  return {
    id: chat.id,
    title: chat.title || titleFromMessages(chat.messages),
    createdAt: chat.createdAt || timestamp,
    updatedAt: chat.updatedAt || timestamp,
    messages: chat.messages
  };
}

async function toStoredRecord(chat: Chat): Promise<StoredStandaloneChatRecord> {
  const record = toRecord(chat);
  if (!standaloneChatEncryptionConfigured()) {
    return record;
  }
  await restoreRememberedStandaloneChatEncryption();
  return encryptStandaloneChatRecord(record);
}

function toChatInfo(record: StandaloneChatRecord): ChatInfo {
  return {
    id: record.id,
    title: record.title || titleFromMessages(record.messages),
    userExcerpt: excerptFromMessages(record.messages),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toLockedChatInfo(record: EncryptedStandaloneChatRecord): ChatInfo {
  return {
    id: record.id,
    title: "Locked chat",
    userExcerpt: "Unlock encrypted browser chats in settings.",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toChat(record: StandaloneChatRecord): Chat {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messages: record.messages
  };
}

export async function listStandaloneChats(): Promise<ChatsResponse> {
  await restoreRememberedStandaloneChatEncryption();
  const records = await withChatStore<StoredStandaloneChatRecord[]>("readonly", (store) => store.getAll());
  const chatInfos = await Promise.all(records.map(toStoredChatInfo));
  return {
    chatInfos: chatInfos
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  };
}

export async function getStandaloneChat(chatId: string): Promise<ChatResponse> {
  await restoreRememberedStandaloneChatEncryption();
  const record = await withChatStore<StoredStandaloneChatRecord | undefined>("readonly", (store) =>
    store.get(chatId)
  );

  if (!record) {
    throw new Error("Chat was not found in this browser.");
  }

  return { chat: toChat(await decryptStandaloneChatRecord(record)) };
}

export async function saveStandaloneChat(chat: Chat): Promise<void> {
  const record = await toStoredRecord(chat);
  await withChatStore<IDBValidKey>("readwrite", (store) => store.put(record));
}

export async function renameStandaloneChat(chatId: string, title: string): Promise<void> {
  const response = await getStandaloneChat(chatId);
  await saveStandaloneChat({
    ...response.chat,
    title,
    updatedAt: nowIso()
  });
}

export async function deleteStandaloneChat(chatId: string): Promise<void> {
  await withChatStore<undefined>("readwrite", (store) => store.delete(chatId));
}

export async function deleteStandaloneChatMessage(
  chatId: string,
  messageIndex: number
): Promise<ChatResponse> {
  const response = await getStandaloneChat(chatId);
  if (messageIndex < 0 || messageIndex >= response.chat.messages.length) {
    throw new Error("Message was not found in this chat.");
  }

  const nextChat: Chat = {
    ...response.chat,
    messages: response.chat.messages.filter((_, index) => index !== messageIndex),
    updatedAt: nowIso()
  };
  await saveStandaloneChat(nextChat);
  return { chat: nextChat };
}

export async function branchStandaloneChat(
  chatId: string,
  messageIndex: number
): Promise<ChatResponse> {
  const response = await getStandaloneChat(chatId);
  if (messageIndex < 0 || messageIndex >= response.chat.messages.length) {
    throw new Error("Message was not found in this chat.");
  }

  const timestamp = nowIso();
  const branch: Chat = {
    id: createStandaloneChatId(),
    title: branchTitle(response.chat.title || titleFromMessages(response.chat.messages)),
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: response.chat.messages.slice(0, messageIndex + 1).map((message) => ({
      ...message,
      status: message.status === "streaming" || message.status === "sending" ? "complete" : message.status,
      updatedAt: timestamp
    }))
  };

  await saveStandaloneChat(branch);
  return { chat: branch };
}

export async function deleteAllStandaloneChats(): Promise<number> {
  const records = await withChatStore<StoredStandaloneChatRecord[]>("readonly", (store) => store.getAll());
  await withChatStore<undefined>("readwrite", (store) => store.clear());
  return records.length;
}

async function toStoredChatInfo(record: StoredStandaloneChatRecord): Promise<ChatInfo> {
  if (!isEncryptedStandaloneChatRecord(record)) {
    return toChatInfo(record);
  }
  await restoreRememberedStandaloneChatEncryption();
  if (!standaloneChatEncryptionKey) {
    return toLockedChatInfo(record);
  }

  try {
    return toChatInfo(await decryptStandaloneChatRecord(record));
  } catch {
    return {
      ...toLockedChatInfo(record),
      userExcerpt: "This encrypted chat could not be read."
    };
  }
}

async function rewriteStandaloneChatsForEncryption(encrypt: boolean) {
  await restoreRememberedStandaloneChatEncryption();
  const records = await withChatStore<StoredStandaloneChatRecord[]>("readonly", (store) => store.getAll());
  const rewritten: StoredStandaloneChatRecord[] = [];

  for (const record of records) {
    if (encrypt) {
      if (isEncryptedStandaloneChatRecord(record)) {
        rewritten.push(record);
      } else {
        rewritten.push(await encryptStandaloneChatRecord(record));
      }
      continue;
    }

    rewritten.push(await decryptStandaloneChatRecord(record));
  }

  await withChatStore<undefined>("readwrite", (store) => store.clear());
  for (const record of rewritten) {
    await withChatStore<IDBValidKey>("readwrite", (store) => store.put(record));
  }
}

async function encryptStandaloneChatRecord(
  record: StandaloneChatRecord
): Promise<EncryptedStandaloneChatRecord> {
  if (!standaloneChatEncryptionKey) {
    throw new Error("Encrypted browser chat storage is locked.");
  }

  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(iv) },
    standaloneChatEncryptionKey,
    bufferSource(new TextEncoder().encode(JSON.stringify(record)))
  );

  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    encrypted: true,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptStandaloneChatRecord(
  record: StoredStandaloneChatRecord
): Promise<StandaloneChatRecord> {
  if (!isEncryptedStandaloneChatRecord(record)) {
    return record;
  }
  await restoreRememberedStandaloneChatEncryption();
  if (!standaloneChatEncryptionKey) {
    throw new Error("Encrypted browser chat storage is locked.");
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bufferSource(base64ToBytes(record.iv)) },
      standaloneChatEncryptionKey,
      bufferSource(base64ToBytes(record.ciphertext))
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as StandaloneChatRecord;
    return {
      ...parsed,
      id: record.id,
      createdAt: parsed.createdAt || record.createdAt,
      updatedAt: parsed.updatedAt || record.updatedAt
    };
  } catch {
    throw new Error("Could not decrypt encrypted browser chat.");
  }
}

function isEncryptedStandaloneChatRecord(
  record: StoredStandaloneChatRecord
): record is EncryptedStandaloneChatRecord {
  return "encrypted" in record && record.encrypted === true;
}

function createStandaloneChatId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function branchTitle(title: string) {
  const base = title.trim() || "New chat";
  const suffix = " branch";
  if (base.toLowerCase().endsWith(suffix)) return base;
  const limit = 64 - suffix.length;
  return `${base.length > limit ? `${base.slice(0, Math.max(0, limit - 3))}...` : base}${suffix}`;
}

function ensureStandaloneChatCrypto() {
  if (!supportsStandaloneChatEncryption()) {
    throw new Error("Encrypted browser chat storage is not supported in this browser.");
  }
}

function readChatEncryptionRecord(storage?: Storage) {
  const targetStorage = getBrowserStorage(storage);
  if (!targetStorage) return null;

  const raw = targetStorage.getItem(CHAT_ENCRYPTION_KEY);
  if (!raw) return null;

  try {
    const record = JSON.parse(raw) as StandaloneChatEncryptionRecord;
    if (
      record.version !== CHAT_ENCRYPTION_VERSION ||
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

function readBrowserChatEncryptionKeyRecord(storage?: Storage) {
  const targetStorage = getBrowserStorage(storage);
  if (!targetStorage) return null;

  const raw = targetStorage.getItem(CHAT_ENCRYPTION_BROWSER_KEY);
  if (!raw) return null;

  try {
    const record = JSON.parse(raw) as BrowserChatEncryptionKeyRecord;
    if (
      record.version !== CHAT_ENCRYPTION_VERSION ||
      record.storage !== "browser" ||
      record.algorithm !== "AES-GCM" ||
      typeof record.key !== "string"
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

function getBrowserStorage(storage?: Storage) {
  if (storage) return storage;
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

async function validateStandaloneChatKey(key: CryptoKey, record: StandaloneChatEncryptionRecord) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferSource(base64ToBytes(record.iv)) },
    key,
    bufferSource(base64ToBytes(record.ciphertext))
  );
  if (new TextDecoder().decode(plaintext) !== CHAT_ENCRYPTION_SENTINEL) {
    throw new Error("invalid sentinel");
  }
}

async function deriveStandaloneChatKeyBytes(
  passphrase: string,
  salt: Uint8Array,
  iterations = CHAT_ENCRYPTION_ITERATIONS
) {
  const material = await crypto.subtle.importKey(
    "raw",
    bufferSource(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: bufferSource(salt),
      iterations,
      hash: "SHA-256"
    },
    material,
    256
  );
  return new Uint8Array(bits);
}

async function importStandaloneChatKey(keyBytes: Uint8Array) {
  return crypto.subtle.importKey(
    "raw",
    bufferSource(keyBytes),
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
