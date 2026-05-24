import type { AppMode } from "@/lib/appMode";
import {
  createAdminAuthRecord,
  adminAuthConfigured,
  adminSessionActive,
  clearAdminSession,
  markAdminSession,
  parseAdminAuthRecord,
  resetAdminAuth,
  setupAdminPassphrase,
  storedAdminAuthRecord,
  verifyAdminAuthRecord,
  verifyAdminPassphrase
} from "@/lib/admin/admin-auth";
import {
  deleteDesktopAdminAuth,
  getDesktopAdminAuth,
  setDesktopAdminAuth
} from "@/lib/ollama/client";

interface AdminAuthState {
  configured: boolean;
  unlocked: boolean;
}

export async function loadAdminAuthState(
  mode: AppMode,
  signal?: AbortSignal
): Promise<AdminAuthState> {
  if (mode !== "desktop") {
    return {
      configured: adminAuthConfigured(),
      unlocked: adminSessionActive()
    };
  }

  const response = await getDesktopAdminAuth(signal);
  if (!response.configured) {
    const localRecord = storedAdminAuthRecord();
    if (localRecord) {
      await setDesktopAdminAuth(localRecord);
      return {
        configured: true,
        unlocked: adminSessionActive()
      };
    }
  }

  return {
    configured: Boolean(response.configured && parseAdminAuthRecord(response.record)),
    unlocked: adminSessionActive()
  };
}

export async function setupAdminLogin(mode: AppMode, passphrase: string) {
  if (mode !== "desktop") {
    await setupAdminPassphrase(passphrase);
    return;
  }

  const record = await createAdminAuthRecord(passphrase);
  await setDesktopAdminAuth(record);
  markAdminSession();
}

export async function verifyAdminLogin(mode: AppMode, passphrase: string) {
  if (mode !== "desktop") {
    return verifyAdminPassphrase(passphrase);
  }

  const response = await getDesktopAdminAuth();
  const record = parseAdminAuthRecord(response.record);
  if (!response.configured || !record) {
    throw new Error("Admin login is not configured.");
  }

  const verified = await verifyAdminAuthRecord(passphrase, record);
  if (verified) {
    markAdminSession();
  }
  return verified;
}

export async function resetAdminLogin(mode: AppMode) {
  if (mode === "desktop") {
    await deleteDesktopAdminAuth();
    clearAdminSession();
    return;
  }

  resetAdminAuth();
}
