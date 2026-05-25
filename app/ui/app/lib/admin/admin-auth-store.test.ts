import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteDesktopAdminAuth } from "@/lib/ollama/client";
import { resetAdminLogin } from "./admin-auth-store";

vi.mock("@/lib/ollama/client", () => ({
  deleteDesktopAdminAuth: vi.fn(() => Promise.resolve({ configured: false })),
  getDesktopAdminAuth: vi.fn(),
  setDesktopAdminAuth: vi.fn()
}));

const ADMIN_AUTH_KEY = "ollama.app.admin.auth.v1";
const ADMIN_SESSION_KEY = "ollama.app.admin.session.v1";

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
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("admin auth store", () => {
  it("resets desktop admin login through the verifier endpoint only", async () => {
    vi.stubGlobal("sessionStorage", new MemoryStorage());

    await resetAdminLogin("desktop");

    expect(deleteDesktopAdminAuth).toHaveBeenCalledOnce();
  });

  it("resets standalone admin login without clearing unrelated browser data", async () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(ADMIN_AUTH_KEY, "verifier");
    local.setItem("ollama.app.chat.encryption.v1", "keep");
    session.setItem(ADMIN_SESSION_KEY, "session");
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);

    await resetAdminLogin("standalone");

    expect(local.getItem(ADMIN_AUTH_KEY)).toBeNull();
    expect(session.getItem(ADMIN_SESSION_KEY)).toBeNull();
    expect(local.getItem("ollama.app.chat.encryption.v1")).toBe("keep");
  });
});
