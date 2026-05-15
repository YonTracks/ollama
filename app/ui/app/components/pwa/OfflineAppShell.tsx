import { WifiOff } from "lucide-react";

export function OfflineAppShell() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-md border border-border bg-panel p-6 text-center shadow-panel">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-panel-strong text-warning">
          <WifiOff className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">Offline</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The local app shell is cached. Ollama API requests need the local server connection.
        </p>
      </div>
    </main>
  );
}
