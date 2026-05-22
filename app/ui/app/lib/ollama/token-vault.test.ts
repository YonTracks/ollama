import { describe, expect, it } from "vitest";
import {
  browserCoreApiTokenExists,
  clearBrowserCoreApiToken,
  clearEncryptedCoreApiToken,
  encryptedCoreApiTokenExists,
  loadBrowserCoreApiToken,
  loadEncryptedCoreApiToken,
  readBrowserCoreApiTokenRecord,
  readEncryptedCoreApiTokenRecord,
  saveBrowserCoreApiToken,
  saveEncryptedCoreApiToken
} from "./token-vault";

describe("standalone token vault", () => {
  it("stores only encrypted token material", async () => {
    const storage = memoryStorage();

    await saveEncryptedCoreApiToken("test-token-123", "passphrase", storage);

    expect(encryptedCoreApiTokenExists(storage)).toBe(true);
    expect(storage.dump()).not.toContain("test-token-123");
    await expect(loadEncryptedCoreApiToken("passphrase", storage)).resolves.toBe(
      "test-token-123"
    );
    await expect(loadEncryptedCoreApiToken("wrong", storage)).rejects.toThrow(
      "Could not unlock"
    );

    clearEncryptedCoreApiToken(storage);
    expect(encryptedCoreApiTokenExists(storage)).toBe(false);
  });

  it("ignores malformed vault records", () => {
    const storage = memoryStorage();
    storage.setItem("ollama.app.standalone.core-token.v1", JSON.stringify({ version: 99 }));

    expect(readEncryptedCoreApiTokenRecord(storage)).toBeNull();
  });

  it("stores a browser-remembered token for automatic reconnect", () => {
    const storage = memoryStorage();

    saveBrowserCoreApiToken("test-token-123", storage);

    expect(browserCoreApiTokenExists(storage)).toBe(true);
    expect(readBrowserCoreApiTokenRecord(storage)).toMatchObject({
      storage: "browser"
    });
    expect(loadBrowserCoreApiToken(storage)).toBe("test-token-123");

    clearBrowserCoreApiToken(storage);
    expect(browserCoreApiTokenExists(storage)).toBe(false);
    expect(loadBrowserCoreApiToken(storage)).toBe("");
  });
});

function memoryStorage(): Storage & { dump(): string } {
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
    },
    dump() {
      return JSON.stringify(Object.fromEntries(data));
    }
  };
}
