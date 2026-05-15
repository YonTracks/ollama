"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getDefaultAppMode,
  readBrowserAppMode,
  writeBrowserAppMode,
  type AppMode
} from "@/lib/appMode";

export function useAppMode() {
  const [mode, setModeState] = useState<AppMode>(getDefaultAppMode);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setModeState(readBrowserAppMode());
    setReady(true);
  }, []);

  const setMode = useCallback((nextMode: AppMode) => {
    writeBrowserAppMode(nextMode);
    setModeState(nextMode);
  }, []);

  return useMemo(
    () => ({
      mode,
      ready,
      standalone: mode === "standalone",
      setMode
    }),
    [mode, ready, setMode]
  );
}
