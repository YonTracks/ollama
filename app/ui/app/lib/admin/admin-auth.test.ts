import { describe, expect, it } from "vitest";
import {
  adminAuthConfigured,
  adminSessionActive,
  clearAdminSession,
  createAdminAuthRecord,
  parseAdminAuthRecord,
  resetAdminAuth,
  setupAdminPassphrase,
  verifyAdminAuthRecord,
  verifyAdminPassphrase
} from "./admin-auth";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  dump() {
    return Array.from(this.values.entries());
  }
}

describe("admin auth", () => {
  it("stores a derived verifier and opens a short-lived session", async () => {
    const authStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();

    await setupAdminPassphrase("correct horse", authStorage, sessionStorage);

    expect(adminAuthConfigured(authStorage)).toBe(true);
    expect(adminSessionActive(sessionStorage)).toBe(true);
    expect(JSON.stringify(authStorage.dump())).not.toContain("correct horse");
  });

  it("verifies the passphrase without accepting the wrong one", async () => {
    const authStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();

    await setupAdminPassphrase("correct horse", authStorage, sessionStorage);
    clearAdminSession(sessionStorage);

    await expect(verifyAdminPassphrase("wrong horse", authStorage, sessionStorage)).resolves.toBe(
      false
    );
    expect(adminSessionActive(sessionStorage)).toBe(false);

    await expect(
      verifyAdminPassphrase("correct horse", authStorage, sessionStorage)
    ).resolves.toBe(true);
    expect(adminSessionActive(sessionStorage)).toBe(true);
  });

  it("expires stale sessions and can reset admin auth", async () => {
    const authStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();

    await setupAdminPassphrase("correct horse", authStorage, sessionStorage);
    expect(adminSessionActive(sessionStorage, Date.now() + 20 * 60 * 1000)).toBe(false);

    resetAdminAuth(authStorage, sessionStorage);
    expect(adminAuthConfigured(authStorage)).toBe(false);
    expect(adminSessionActive(sessionStorage)).toBe(false);
  });

  it("exports a verifier record that can be stored outside browser localStorage", async () => {
    const record = await createAdminAuthRecord("correct horse");

    expect(JSON.stringify(record)).not.toContain("correct horse");
    expect(parseAdminAuthRecord(record)).toEqual(record);
    await expect(verifyAdminAuthRecord("wrong horse", record)).resolves.toBe(false);
    await expect(verifyAdminAuthRecord("correct horse", record)).resolves.toBe(true);
  });
});
