import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteAllStandaloneChats,
  deleteStandaloneChatMessage,
  disableStandaloneChatEncryption,
  enableStandaloneChatEncryption,
  forgetRememberedStandaloneChatEncryption,
  getStandaloneChat,
  listStandaloneChats,
  lockStandaloneChatEncryption,
  rememberStandaloneChatEncryption,
  renameStandaloneChat,
  saveStandaloneChat,
  standaloneChatEncryptionConfigured,
  standaloneChatEncryptionRemembered,
  standaloneChatEncryptionUnlocked,
  unlockStandaloneChatEncryption
} from "./standalone-db";
import type { Chat } from "./types";

afterEach(() => {
  lockStandaloneChatEncryption();
  vi.unstubAllGlobals();
});

describe("standalone IndexedDB chat persistence", () => {
  it("stores, lists, updates, and clears standalone chats without desktop APIs", async () => {
    installFakeIndexedDb();

    await saveStandaloneChat(chatRecord("chat-old", "Old", "2026-05-19T00:00:00.000Z"));
    await saveStandaloneChat(chatRecord("chat-new", "New", "2026-05-20T00:00:00.000Z"));

    await expect(listStandaloneChats()).resolves.toMatchObject({
      chatInfos: [
        { id: "chat-new", title: "New" },
        { id: "chat-old", title: "Old" }
      ]
    });

    await renameStandaloneChat("chat-old", "Renamed");
    await expect(getStandaloneChat("chat-old")).resolves.toMatchObject({
      chat: { id: "chat-old", title: "Renamed" }
    });

    await expect(deleteStandaloneChatMessage("chat-old", 0)).resolves.toMatchObject({
      chat: { id: "chat-old", messages: [] }
    });

    await expect(deleteAllStandaloneChats()).resolves.toBe(2);
    await expect(listStandaloneChats()).resolves.toEqual({ chatInfos: [] });
  });

  it("encrypts standalone chat records when browser chat encryption is enabled", async () => {
    const db = installFakeIndexedDb();
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);

    await saveStandaloneChat(chatRecord("chat-secret", "Secret chat", "2026-05-20T00:00:00.000Z"));
    await enableStandaloneChatEncryption("passphrase");

    expect(standaloneChatEncryptionConfigured()).toBe(true);
    expect(standaloneChatEncryptionUnlocked()).toBe(true);

    let rawRecord = db.dumpRecords()[0] as { encrypted?: boolean };
    expect(rawRecord.encrypted).toBe(true);
    expect(JSON.stringify(rawRecord)).not.toContain("Secret chat");

    await expect(getStandaloneChat("chat-secret")).resolves.toMatchObject({
      chat: { id: "chat-secret", title: "Secret chat" }
    });

    lockStandaloneChatEncryption();
    await expect(listStandaloneChats()).resolves.toMatchObject({
      chatInfos: [{ id: "chat-secret", title: "Locked chat" }]
    });
    await expect(getStandaloneChat("chat-secret")).rejects.toThrow("locked");

    await expect(unlockStandaloneChatEncryption("wrong")).rejects.toThrow("Could not unlock");
    await unlockStandaloneChatEncryption("passphrase");
    await expect(getStandaloneChat("chat-secret")).resolves.toMatchObject({
      chat: { id: "chat-secret", title: "Secret chat" }
    });
    await expect(listStandaloneChats()).resolves.toMatchObject({
      chatInfos: [{ id: "chat-secret", title: "Secret chat" }]
    });

    await disableStandaloneChatEncryption();
    expect(standaloneChatEncryptionConfigured()).toBe(false);
    rawRecord = db.dumpRecords()[0] as { encrypted?: boolean };
    expect(rawRecord.encrypted).not.toBe(true);
    expect(JSON.stringify(rawRecord)).toContain("Secret chat");
  });

  it("can remember encrypted browser chat unlocks across restarts", async () => {
    installFakeIndexedDb();
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);

    await saveStandaloneChat(chatRecord("chat-remembered", "Remembered secret", "2026-05-20T00:00:00.000Z"));
    await enableStandaloneChatEncryption("passphrase");
    await rememberStandaloneChatEncryption();

    expect(standaloneChatEncryptionRemembered()).toBe(true);

    lockStandaloneChatEncryption();
    expect(standaloneChatEncryptionUnlocked()).toBe(false);
    await expect(getStandaloneChat("chat-remembered")).resolves.toMatchObject({
      chat: { id: "chat-remembered", title: "Remembered secret" }
    });
    await expect(listStandaloneChats()).resolves.toMatchObject({
      chatInfos: [{ id: "chat-remembered", title: "Remembered secret" }]
    });
    expect(standaloneChatEncryptionUnlocked()).toBe(true);

    forgetRememberedStandaloneChatEncryption();
    expect(standaloneChatEncryptionRemembered()).toBe(false);
    lockStandaloneChatEncryption();
    await expect(getStandaloneChat("chat-remembered")).rejects.toThrow("locked");
    await unlockStandaloneChatEncryption("passphrase");
    await expect(getStandaloneChat("chat-remembered")).resolves.toMatchObject({
      chat: { id: "chat-remembered", title: "Remembered secret" }
    });
  });
});

function chatRecord(id: string, title: string, updatedAt: string): Chat {
  return {
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    messages: [
      {
        id: `${id}-user`,
        role: "user",
        content: title,
        status: "complete"
      }
    ]
  };
}

function installFakeIndexedDb() {
  const db = new FakeIDBDatabase();
  vi.stubGlobal("IDBRequest", FakeIDBRequest);
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request = new FakeIDBOpenRequest(db);
      queueMicrotask(() => {
        if (!db.upgraded) {
          db.upgraded = true;
          request.onupgradeneeded?.call(request as unknown as IDBOpenDBRequest, new Event("upgradeneeded"));
        }
        request.onsuccess?.call(request as unknown as IDBRequest<IDBDatabase>, new Event("success"));
      });
      return request as unknown as IDBOpenDBRequest;
    }
  });
  return db;
}

class FakeIDBRequest<T = unknown> {
  result!: T;
  error: DOMException | Error | null = null;
  onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
  onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;

  constructor(result?: T) {
    if (result !== undefined) {
      this.result = result;
    }
  }
}

class FakeIDBOpenRequest extends FakeIDBRequest<IDBDatabase> {
  onupgradeneeded: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null = null;

  constructor(db: FakeIDBDatabase) {
    super(db as unknown as IDBDatabase);
  }
}

class FakeIDBDatabase {
  upgraded = false;
  private readonly stores = new Map<string, Map<string, unknown>>();

  objectStoreNames = {
    contains: (name: string) => this.stores.has(name)
  };

  createObjectStore(name: string) {
    const records = new Map<string, unknown>();
    this.stores.set(name, records);
    return {
      createIndex: () => undefined
    };
  }

  transaction(name: string) {
    const records = this.stores.get(name);
    if (!records) throw new Error(`Missing object store ${name}.`);
    return new FakeIDBTransaction(records);
  }

  dumpRecords(name = "chats") {
    return [...(this.stores.get(name)?.values() ?? [])].map(cloneValue);
  }

  close() {
    return undefined;
  }
}

class FakeIDBTransaction {
  oncomplete: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  onabort: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
  error: DOMException | Error | null = null;

  constructor(private readonly records: Map<string, unknown>) {}

  objectStore() {
    return new FakeIDBObjectStore(this.records, this);
  }

  complete() {
    queueMicrotask(() => {
      this.oncomplete?.call(this as unknown as IDBTransaction, new Event("complete"));
    });
  }
}

class FakeIDBObjectStore {
  constructor(
    private readonly records: Map<string, unknown>,
    private readonly transaction: FakeIDBTransaction
  ) {}

  getAll() {
    return this.request(() => [...this.records.values()].map(cloneValue));
  }

  get(key: string) {
    return this.request(() => cloneValue(this.records.get(key)));
  }

  put(value: { id: string }) {
    return this.request(() => {
      this.records.set(value.id, cloneValue(value));
      return value.id;
    });
  }

  delete(key: string) {
    return this.request(() => {
      this.records.delete(key);
      return undefined;
    });
  }

  clear() {
    return this.request(() => {
      this.records.clear();
      return undefined;
    });
  }

  private request<T>(callback: () => T) {
    const request = new FakeIDBRequest<T>();
    queueMicrotask(() => {
      try {
        request.result = callback();
        request.onsuccess?.call(request as unknown as IDBRequest<T>, new Event("success"));
        this.transaction.complete();
      } catch (error) {
        request.error = error instanceof Error ? error : new Error("IndexedDB request failed.");
        request.onerror?.call(request as unknown as IDBRequest<T>, new Event("error"));
      }
    });
    return request as unknown as IDBRequest<T>;
  }
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    }
  };
}
