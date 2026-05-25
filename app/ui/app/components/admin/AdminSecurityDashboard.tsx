"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Cloud,
  Database,
  HardDrive,
  KeyRound,
  Lock,
  RefreshCcw,
  Search,
  Server,
  Shield,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
  type LucideIcon
} from "lucide-react";
import {
  adminSessionActive,
  clearAdminSession
} from "@/lib/admin/admin-auth";
import {
  loadAdminAuthState,
  resetAdminLogin,
  setupAdminLogin,
  verifyAdminLogin
} from "@/lib/admin/admin-auth-store";
import { getApiBase, getSecurityStatus } from "@/lib/ollama/client";
import {
  DEFAULT_CORE_API_BASE,
  getCoreApiBase
} from "@/lib/ollama/standalone";
import {
  restoreRememberedStandaloneChatEncryption,
  standaloneChatEncryptionConfigured,
  standaloneChatEncryptionRemembered,
  standaloneChatEncryptionUnlocked
} from "@/lib/ollama/standalone-db";
import {
  browserCoreApiTokenExists,
  encryptedCoreApiTokenExists
} from "@/lib/ollama/token-vault";
import { usePwaCacheDiagnostics } from "@/lib/pwa/cache-diagnostics";
import { useAppMode } from "@/hooks/useAppMode";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { useOllamaConnection } from "@/hooks/useOllamaConnection";
import { cn } from "@/lib/utils";
import type { AppDataEncryptionState, SecurityStatusResponse } from "@/lib/ollama/types";
import type { LocalSettings } from "@/types/app";

type TileTone = "success" | "warning" | "danger" | "info";

interface StatusTileConfig {
  label: string;
  value: string;
  tone: TileTone;
  Icon: LucideIcon;
  detail?: ReactNode;
  spin?: boolean;
}

interface StandaloneEncryptionState {
  configured: boolean;
  unlocked: boolean;
  remembered: boolean;
}

interface TokenState {
  browser: boolean;
  encrypted: boolean;
}

const defaultStandaloneEncryption: StandaloneEncryptionState = {
  configured: false,
  unlocked: false,
  remembered: false
};

const defaultTokenState: TokenState = {
  browser: false,
  encrypted: false
};

interface AdminSecurityDashboardProps {
  onClose?: () => void;
}

export function AdminSecurityDashboard({ onClose }: AdminSecurityDashboardProps = {}) {
  const appMode = useAppMode();
  const settingsState = useLocalSettings(appMode.mode, appMode.ready);
  const { settings } = settingsState;
  const connection = useOllamaConnection(
    appMode.mode,
    settings.coreApiBase,
    settings.coreApiToken,
    appMode.ready
  );
  const cacheDiagnostics = usePwaCacheDiagnostics(appMode.ready);

  const [authReady, setAuthReady] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<SecurityStatusResponse | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [standaloneEncryption, setStandaloneEncryption] =
    useState<StandaloneEncryptionState>(defaultStandaloneEncryption);
  const [tokenState, setTokenState] = useState<TokenState>(defaultTokenState);

  const standalone = appMode.mode === "standalone";

  const refreshAuthState = useCallback(
    async (signal?: AbortSignal) => {
      setAuthReady(false);
      try {
        const state = await loadAdminAuthState(appMode.mode, signal);
        if (signal?.aborted) return;
        setAuthConfigured(state.configured);
        setUnlocked(state.unlocked);
      } catch {
        if (signal?.aborted) return;
        setAuthConfigured(false);
        setUnlocked(adminSessionActive());
      } finally {
        if (!signal?.aborted) setAuthReady(true);
      }
    },
    [appMode.mode]
  );

  const refreshSecurityStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (standalone || !appMode.ready) return;

      setSecurityLoading(true);
      setSecurityError(null);
      try {
        const status = await getSecurityStatus(signal);
        setSecurityStatus(status);
      } catch (error) {
        if (!signal?.aborted) {
          setSecurityStatus(null);
          setSecurityError(
            error instanceof Error ? error.message : "Failed to load security status."
          );
        }
      } finally {
        if (!signal?.aborted) setSecurityLoading(false);
      }
    },
    [appMode.ready, standalone]
  );

  const refreshStandaloneState = useCallback(async () => {
    if (!standalone || !appMode.ready) return;

    await restoreRememberedStandaloneChatEncryption().catch(() => false);
    setStandaloneEncryption({
      configured: standaloneChatEncryptionConfigured(),
      unlocked: standaloneChatEncryptionUnlocked(),
      remembered: standaloneChatEncryptionRemembered()
    });
    setTokenState({
      browser: browserCoreApiTokenExists(),
      encrypted: encryptedCoreApiTokenExists()
    });
  }, [appMode.ready, standalone]);

  useEffect(() => {
    const controller = new AbortController();
    void refreshAuthState(controller.signal);
    return () => controller.abort();
  }, [refreshAuthState]);

  useEffect(() => {
    const controller = new AbortController();
    refreshSecurityStatus(controller.signal);
    return () => controller.abort();
  }, [refreshSecurityStatus]);

  useEffect(() => {
    refreshStandaloneState();
  }, [refreshStandaloneState]);

  const refreshAll = useCallback(() => {
    const controller = new AbortController();
    void refreshSecurityStatus(controller.signal);
    void refreshStandaloneState();
    void connection.refresh();
    void cacheDiagnostics.refresh();
  }, [cacheDiagnostics, connection, refreshSecurityStatus, refreshStandaloneState]);

  const lockDashboard = useCallback(() => {
    clearAdminSession();
    setUnlocked(false);
  }, []);

  const resetDashboardLogin = useCallback(async () => {
    await resetAdminLogin(appMode.mode);
    setAuthConfigured(false);
    setUnlocked(false);
  }, [appMode.mode]);

  const tiles = useMemo(
    () =>
      buildDashboardTiles({
        standalone,
        settings,
        connection,
        securityStatus,
        securityLoading,
        securityError,
        standaloneEncryption,
        tokenState,
        cacheDiagnostics
      }),
    [
      cacheDiagnostics,
      connection,
      securityError,
      securityLoading,
      securityStatus,
      settings,
      standalone,
      standaloneEncryption,
      tokenState
    ]
  );

  if (!authReady || !appMode.ready) {
    return (
      <AdminShell onClose={onClose}>
        <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
          <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
          Loading admin security state
        </div>
      </AdminShell>
    );
  }

  if (!unlocked) {
    return (
      <AdminShell onClose={onClose}>
        <AdminLogin
          configured={authConfigured}
          onSetup={(passphrase) => setupAdminLogin(appMode.mode, passphrase)}
          onVerify={(passphrase) => verifyAdminLogin(appMode.mode, passphrase)}
          onReset={resetDashboardLogin}
          onConfigured={() => {
            setAuthConfigured(true);
            setUnlocked(true);
          }}
          onUnlocked={() => setUnlocked(true)}
        />
      </AdminShell>
    );
  }

  const warnings = securityStatus?.warnings ?? [];
  const sensitiveCacheEntries = cacheDiagnostics.sensitiveEntries.slice(0, 5);

  return (
    <AdminShell
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-panel px-3 text-sm hover:bg-muted focus:focus-ring"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={lockDashboard}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-panel px-3 text-sm hover:bg-muted focus:focus-ring"
          >
            <Lock className="h-4 w-4" />
            Lock
          </button>
        </>
      }
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <StatusTile key={`${tile.label}-${tile.value}`} {...tile} />
        ))}
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <DetailPanel title="Runtime Details" Icon={Server}>
          <DetailRow label="UI mode" value={standalone ? "Standalone PWA" : "Desktop app"} />
          <DetailRow
            label="Core API"
            value={
              standalone
                ? getCoreApiBase(settings.coreApiBase)
                : securityStatus?.coreApiBase || getApiBase() || "same origin"
            }
          />
          <DetailRow
            label="App version"
            value={connection.version ? connection.version : "unavailable"}
          />
          <DetailRow
            label="Search"
            value={`${settings.webSearchMode} / ${settings.webSearchProvider}`}
          />
          <DetailRow
            label="Memory"
            value={`${settings.enableRetrieval ? "active" : "off"} / ${memoryScopeLabel(settings.retrievalScope)}`}
          />
        </DetailPanel>

        <DetailPanel title="Cache Details" Icon={HardDrive}>
          <DetailRow
            label="Service worker"
            value={
              cacheDiagnostics.serviceWorkerSupported
                ? cacheDiagnostics.registered
                  ? `${cacheDiagnostics.registrationCount} registered`
                  : "not registered"
                : "not supported"
            }
          />
          <DetailRow
            label="Cache storage"
            value={
              cacheDiagnostics.supported
                ? `${cacheDiagnostics.cacheNames.length} caches / ${cacheDiagnostics.entryCount} entries`
                : "not supported"
            }
          />
          <DetailRow label="API entries" value={String(cacheDiagnostics.apiEntryCount)} />
          <DetailRow label="Sensitive URL entries" value={String(cacheDiagnostics.sensitiveEntryCount)} />
          {cacheDiagnostics.cacheNames.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {cacheDiagnostics.cacheNames.map((cacheName) => (
                <code
                  key={cacheName}
                  className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                >
                  {cacheName}
                </code>
              ))}
            </div>
          ) : null}
        </DetailPanel>
      </section>

      {warnings.length > 0 || securityError || cacheDiagnostics.error ? (
        <section className="mt-5 rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            Active Warnings
          </div>
          <div className="space-y-1 leading-5">
            {securityError ? <div>{securityError}</div> : null}
            {cacheDiagnostics.error ? <div>{cacheDiagnostics.error}</div> : null}
            {warnings.map((warning) => (
              <div key={warning.code}>{warning.message}</div>
            ))}
          </div>
        </section>
      ) : null}

      {sensitiveCacheEntries.length > 0 ? (
        <section className="mt-5 rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            Sensitive Cache Entries
          </div>
          <div className="space-y-1 break-all font-mono text-xs leading-5">
            {sensitiveCacheEntries.map((entry) => (
              <div key={entry}>{entry}</div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => {
            void resetDashboardLogin();
          }}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 text-sm text-danger hover:bg-danger/15 focus:focus-ring"
        >
          <Trash2 className="h-4 w-4" />
          Reset admin login
        </button>
      </section>
    </AdminShell>
  );
}

function AdminLogin({
  configured,
  onSetup,
  onVerify,
  onReset,
  onConfigured,
  onUnlocked
}: {
  configured: boolean;
  onSetup(passphrase: string): Promise<void>;
  onVerify(passphrase: string): Promise<boolean>;
  onReset(): Promise<void>;
  onConfigured(): void;
  onUnlocked(): void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const canReset = resetConfirmation.trim() === "RESET ADMIN";

  useEffect(() => {
    setResetOpen(false);
    setResetConfirmation("");
    setResetError(null);
  }, [configured]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (!configured) {
        if (passphrase.trim() !== confirmPassphrase.trim()) {
          throw new Error("Admin passphrases do not match.");
        }
        await onSetup(passphrase);
        onConfigured();
      } else {
        const verified = await onVerify(passphrase);
        if (!verified) throw new Error("Admin passphrase did not match.");
        onUnlocked();
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Admin login failed.");
    } finally {
      setBusy(false);
    }
  };

  const resetLogin = async () => {
    if (!canReset) return;

    setResetBusy(true);
    setResetError(null);
    setError(null);
    try {
      await onReset();
      setPassphrase("");
      setConfirmPassphrase("");
      setResetConfirmation("");
      setResetOpen(false);
    } catch (resetFailure) {
      setResetError(
        resetFailure instanceof Error ? resetFailure.message : "Admin login reset failed."
      );
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-md border border-border bg-panel-strong p-5 shadow-panel">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold">
            {configured ? "Admin login" : "Create admin login"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {configured ? "Unlock this browser session." : "Protect this dashboard in this browser."}
          </p>
        </div>
      </div>

      <form className="space-y-3" onSubmit={submit}>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Passphrase</span>
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            autoComplete={configured ? "current-password" : "new-password"}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:focus-ring"
          />
        </label>

        {!configured ? (
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Confirm passphrase</span>
            <input
              type="password"
              value={confirmPassphrase}
              onChange={(event) => setConfirmPassphrase(event.target.value)}
              autoComplete="new-password"
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:focus-ring"
            />
          </label>
        ) : null}

        {error ? <div className="text-sm text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:brightness-105 disabled:opacity-60 focus:focus-ring"
        >
          {busy ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {configured ? "Unlock dashboard" : "Create and unlock"}
        </button>
      </form>

      {configured ? (
        <div className="mt-4 border-t border-border pt-4">
          {!resetOpen ? (
            <button
              type="button"
              onClick={() => setResetOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 text-sm text-danger hover:bg-danger/15 focus:focus-ring"
            >
              <Trash2 className="h-4 w-4" />
              Forgot passphrase
            </button>
          ) : (
            <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm">
              <div className="font-medium text-danger">Reset admin login</div>
              <p className="mt-1 leading-5 text-muted-foreground">
                This removes only the dashboard passphrase. It preserves chats, settings, tokens,
                and encrypted app data, and it cannot recover a lost app-data encryption key.
              </p>
              <label className="mt-3 block">
                <span className="mb-1 block text-xs text-muted-foreground">
                  Type RESET ADMIN to continue
                </span>
                <input
                  value={resetConfirmation}
                  disabled={resetBusy}
                  onChange={(event) => setResetConfirmation(event.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:focus-ring disabled:opacity-60"
                />
              </label>
              {resetError ? <div className="mt-2 text-sm text-danger">{resetError}</div> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canReset || resetBusy}
                  onClick={() => {
                    void resetLogin();
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-danger/40 bg-danger px-3 text-sm font-medium text-background hover:bg-danger/90 disabled:opacity-60 focus:focus-ring"
                >
                  {resetBusy ? (
                    <RefreshCcw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Reset login
                </button>
                <button
                  type="button"
                  disabled={resetBusy}
                  onClick={() => {
                    setResetOpen(false);
                    setResetConfirmation("");
                    setResetError(null);
                  }}
                  className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-60 focus:focus-ring"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AdminShell({
  children,
  actions,
  onClose
}: {
  children: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <main className="app-viewport-safe h-dvh overflow-y-auto bg-background text-foreground scrollbar-subtle">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-4 py-4 sm:px-6">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="flex min-w-0 items-center gap-3">
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-panel hover:bg-muted focus:focus-ring"
                aria-label="Back to chat"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : (
              <Link
                href="/"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-panel hover:bg-muted focus:focus-ring"
                aria-label="Back to chat"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-normal">Admin Security</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Bind, auth, encryption, and cache state
              </p>
            </div>
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </header>
        {children}
      </div>
    </main>
  );
}

function StatusTile({ label, value, tone, Icon, detail, spin }: StatusTileConfig) {
  return (
    <div className={cn("rounded-md border p-4", tileToneClass(tone))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase text-muted-foreground">{label}</div>
          <div className="mt-2 text-base font-semibold">{value}</div>
          {detail ? <div className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</div> : null}
        </div>
        <Icon className={cn("h-5 w-5 flex-none", spin && "animate-spin")} />
      </div>
    </div>
  );
}

function DetailPanel({
  title,
  Icon,
  children
}: {
  title: string;
  Icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-panel-strong p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-accent" />
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-full break-all font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function buildDashboardTiles({
  standalone,
  settings,
  connection,
  securityStatus,
  securityLoading,
  securityError,
  standaloneEncryption,
  tokenState,
  cacheDiagnostics
}: {
  standalone: boolean;
  settings: LocalSettings;
  connection: ReturnType<typeof useOllamaConnection>;
  securityStatus: SecurityStatusResponse | null;
  securityLoading: boolean;
  securityError: string | null;
  standaloneEncryption: StandaloneEncryptionState;
  tokenState: TokenState;
  cacheDiagnostics: ReturnType<typeof usePwaCacheDiagnostics>;
}): StatusTileConfig[] {
  const cacheClear =
    cacheDiagnostics.sensitiveEntryCount === 0 && cacheDiagnostics.apiEntryCount === 0;
  const tokenLabel = standalone
    ? standaloneTokenLabel(settings, tokenState)
    : securityStatus?.coreApiAuthEnabled
      ? "Core token required"
      : "Core token off";
  const encryption = standalone
    ? standaloneEncryptionTile(standaloneEncryption)
    : desktopEncryptionTile(securityStatus, securityLoading);

  return [
    {
      label: "Runtime mode",
      value: standalone ? "Standalone" : "Desktop",
      tone: "info",
      Icon: Shield,
      detail: standalone ? "Browser storage and direct core API" : "Go desktop API and local proxy"
    },
    {
      label: "Core API",
      value:
        connection.status === "connected"
          ? "Reachable"
          : connection.status === "checking"
            ? "Checking"
            : "Unreachable",
      tone:
        connection.status === "connected"
          ? "success"
          : connection.status === "checking"
            ? "info"
            : "warning",
      Icon:
        connection.status === "connected"
          ? CheckCircle2
          : connection.status === "checking"
            ? RefreshCcw
            : AlertCircle,
      spin: connection.status === "checking",
      detail: connection.error || connection.version || undefined
    },
    {
      label: "Bind and exposure",
      value: standalone
        ? getCoreApiBase(settings.coreApiBase) === DEFAULT_CORE_API_BASE
          ? "Default local"
          : "Custom base"
        : securityLoading
          ? "Checking"
          : securityStatus?.networkExposureAllowed
            ? "Network exposure"
            : securityStatus?.coreApiHostLocal && securityStatus.coreApiHostAllowed
              ? "Local only"
              : "Blocked",
      tone: standalone
        ? "info"
        : securityStatus?.networkExposureAllowed
          ? "warning"
          : securityStatus?.coreApiHostLocal && securityStatus.coreApiHostAllowed
            ? "success"
            : securityLoading
              ? "info"
              : "danger",
      Icon: standalone ? Server : securityStatus?.networkExposureAllowed ? AlertCircle : Server,
      spin: securityLoading,
      detail: securityError || securityStatus?.coreApiBase || getCoreApiBase(settings.coreApiBase)
    },
    {
      label: "Auth",
      value: tokenLabel,
      tone:
        standalone && !settings.coreApiToken.trim() && !tokenState.browser && !tokenState.encrypted
          ? "info"
          : !standalone && !securityStatus?.coreApiAuthEnabled
            ? "info"
            : "success",
      Icon: KeyRound,
      detail: !standalone && securityStatus?.desktopAuthEnabled === false ? "Desktop auth disabled in dev" : undefined
    },
    encryption,
    {
      label: "Offline mode",
      value: connection.online ? "Network online" : "Local only",
      tone: connection.online ? "info" : "success",
      Icon: connection.online ? Wifi : WifiOff,
      detail: standalone
        ? "Standalone app shell and browser data"
        : securityStatus?.localOnlyOfflineMode
          ? "Cloud disabled"
          : "Cloud availability depends on settings"
    },
    {
      label: "Search provider",
      value: `${settings.webSearchMode} / ${settings.webSearchProvider}`,
      tone: settings.webSearchMode === "off" ? "success" : "info",
      Icon: Search
    },
    {
      label: "Memory scope",
      value: `${settings.enableRetrieval ? "active" : "off"} / ${memoryScopeLabel(settings.retrievalScope)}`,
      tone: settings.enableRetrieval ? "info" : "warning",
      Icon: BrainCircuit,
      detail:
        settings.retrievalScope === "selected"
          ? `${settings.retrievalChatIds.length} selected`
          : undefined
    },
    {
      label: "PWA cache",
      value: cacheDiagnostics.loading
        ? "Checking"
        : cacheClear
          ? "Clean"
          : "Review needed",
      tone: cacheDiagnostics.loading ? "info" : cacheClear ? "success" : "danger",
      Icon: cacheDiagnostics.loading ? RefreshCcw : cacheClear ? HardDrive : AlertCircle,
      spin: cacheDiagnostics.loading,
      detail: `${cacheDiagnostics.cacheNames.length} caches / ${cacheDiagnostics.entryCount} entries`
    },
    {
      label: "Cloud",
      value: standalone
        ? "Browser direct"
        : securityStatus?.cloudDisabled || securityStatus?.localOnlyOfflineMode
          ? "Disabled"
          : "Allowed",
      tone:
        !standalone && (securityStatus?.cloudDisabled || securityStatus?.localOnlyOfflineMode)
          ? "success"
          : "info",
      Icon: Cloud,
      detail: standalone ? "No desktop cloud setting" : securityStatus?.cloudSource
    }
  ];
}

function standaloneTokenLabel(settings: LocalSettings, tokenState: TokenState) {
  if (settings.coreApiToken.trim()) {
    if (settings.coreApiTokenStorage === "encrypted") return "Token unlocked";
    if (settings.coreApiTokenStorage === "browser") return "Token remembered";
    return "Token session";
  }
  if (tokenState.encrypted) return "Token locked";
  if (tokenState.browser) return "Token remembered";
  return "Token not set";
}

function standaloneEncryptionTile(state: StandaloneEncryptionState): StatusTileConfig {
  if (!state.configured) {
    return {
      label: "Data encryption",
      value: "Browser data plain",
      tone: "info",
      Icon: Database
    };
  }
  if (!state.unlocked) {
    return {
      label: "Data encryption",
      value: "Browser data locked",
      tone: "warning",
      Icon: Lock
    };
  }
  return {
    label: "Data encryption",
    value: state.remembered ? "Encrypted remembered" : "Encrypted session",
    tone: "success",
    Icon: ShieldCheck
  };
}

function desktopEncryptionTile(
  status: SecurityStatusResponse | null,
  loading: boolean
): StatusTileConfig {
  if (!status) {
    return {
      label: "Data encryption",
      value: loading ? "Checking" : "Unknown",
      tone: loading ? "info" : "warning",
      Icon: loading ? RefreshCcw : AlertCircle,
      spin: loading
    };
  }

  const state = status.appDataEncryptionState;
  return {
    label: "Data encryption",
    value: desktopEncryptionLabel(state, status.appDataEncryptionDisabled),
    tone:
      state === "encrypted"
        ? "success"
        : state === "key_missing" || state === "key_invalid"
          ? "danger"
          : state === "legacy_encrypted"
            ? "warning"
            : "info",
    Icon:
      state === "encrypted"
        ? ShieldCheck
        : state === "key_missing" || state === "key_invalid"
          ? AlertCircle
          : Database,
    detail: status.appDataEncryptionError || undefined
  };
}

function desktopEncryptionLabel(state: AppDataEncryptionState, disabled: boolean) {
  switch (state) {
    case "encrypted":
      return "App data encrypted";
    case "legacy_encrypted":
      return "Legacy encryption";
    case "key_missing":
      return "Key missing";
    case "key_invalid":
      return "Wrong key";
    case "enabled":
      return "Encryption ready";
    case "plain":
      return disabled ? "Encryption off" : "App data plain";
    default:
      return "Unknown";
  }
}

function memoryScopeLabel(scope: LocalSettings["retrievalScope"]) {
  if (scope === "all") return "all";
  if (scope === "selected") return "selected";
  return "current";
}

function tileToneClass(tone: TileTone) {
  switch (tone) {
    case "success":
      return "border-success/25 bg-success/10 text-success";
    case "warning":
      return "border-warning/30 bg-warning/10 text-warning";
    case "danger":
      return "border-danger/30 bg-danger/10 text-danger";
    default:
      return "border-border bg-panel-strong text-foreground";
  }
}
