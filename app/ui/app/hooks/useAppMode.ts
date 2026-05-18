"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getDefaultAppMode,
  readBrowserAppMode,
  type AppMode
} from "@/lib/appMode";

export function useAppMode() {
  const [mode, setModeState] = useState<AppMode>(getDefaultAppMode);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setModeState(readBrowserAppMode());
    setReady(true);
  }, []);

  return useMemo(
    () => ({
      mode,
      ready,
      standalone: mode === "standalone"
    }),
    [mode, ready]
  );
}
