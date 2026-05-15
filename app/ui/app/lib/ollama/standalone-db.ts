import type { Chat, ChatInfo, ChatMessage, ChatResponse, ChatsResponse } from "./types";

const DB_NAME = "ollama-app-standalone";
const DB_VERSION = 1;
const CHAT_STORE = "chats";

interface StandaloneChatRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

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

function toChatInfo(record: StandaloneChatRecord): ChatInfo {
  return {
    id: record.id,
    title: record.title || titleFromMessages(record.messages),
    userExcerpt: excerptFromMessages(record.messages),
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
  const records = await withChatStore<StandaloneChatRecord[]>("readonly", (store) => store.getAll());
  return {
    chatInfos: records
      .map(toChatInfo)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  };
}

export async function getStandaloneChat(chatId: string): Promise<ChatResponse> {
  const record = await withChatStore<StandaloneChatRecord | undefined>("readonly", (store) =>
    store.get(chatId)
  );

  if (!record) {
    throw new Error("Chat was not found in this browser.");
  }

  return { chat: toChat(record) };
}

export async function saveStandaloneChat(chat: Chat): Promise<void> {
  const record = toRecord(chat);
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

export async function deleteAllStandaloneChats(): Promise<number> {
  const records = await withChatStore<StandaloneChatRecord[]>("readonly", (store) => store.getAll());
  await withChatStore<undefined>("readwrite", (store) => store.clear());
  return records.length;
}
