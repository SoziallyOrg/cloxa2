"use client";

import { useEffect } from "react";

import { clearShellCache, registerShellWorker } from "@/lib/offline/browser";

/** Registers the /app service worker (offline shell, ADR 006). Renders nothing. */
export function RegisterShellWorker() {
  useEffect(() => {
    void registerShellWorker();
  }, []);
  return null;
}

/** On the login page: drops the cached /app screen of whoever signed out. */
export function ClearShellCache() {
  useEffect(() => {
    void clearShellCache();
  }, []);
  return null;
}
