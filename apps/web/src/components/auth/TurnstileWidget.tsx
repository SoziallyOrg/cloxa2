"use client";

import { useEffect, useRef } from "react";

const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/**
 * Loads the script once. It is created from our own (nonced) bundle, so
 * 'strict-dynamic' trusts it without a nonce of its own.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile"));
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile"));
    };
    document.head.append(script);
  });
  return loading;
}

export interface TurnstileWidgetProps {
  siteKey: string;
  /** Checked on the server, so a token for one form can't be used on another. */
  action: "login" | "confirm" | "pilot";
  /** Changes after every submit: tokens are single-use, so the widget resets. */
  resetSignal: unknown;
}

/**
 * Cloudflare Turnstile inside a form: it adds the hidden
 * `cf-turnstile-response` field. Usually invisible; if it needs a click it
 * shows its own accessible checkbox.
 */
export function TurnstileWidget({
  siteKey,
  action,
  resetSignal,
}: TurnstileWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          action,
          language: "nl",
          size: "flexible",
        });
      })
      // Without a token the server refuses the form with a clear message.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, [resetSignal]);

  return <div ref={container} />;
}
