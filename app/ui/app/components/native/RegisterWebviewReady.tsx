"use client";

import { useEffect } from "react";

export function RegisterWebviewReady() {
  useEffect(() => {
    window.ready?.();
  }, []);

  return null;
}
