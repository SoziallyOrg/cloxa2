import { t } from "@cloxa/i18n";

import { cx } from "../ui/cx";

export interface LogoProps {
  /** `sm` for app headers, `lg` for login. */
  size?: "sm" | "lg";
  /** `on-light`: forest letters, leaf dot. `on-forest`: white letters, lime dot. */
  tone?: "on-light" | "on-forest";
}

const SIZE_CLASSES = {
  sm: "h-7 w-auto",
  lg: "h-10 w-auto",
} as const;

const SOURCES = {
  "on-light": "/branding/cloxa-logo.svg",
  "on-forest": "/branding/cloxa-logo-on-dark.svg",
} as const;

/**
 * The wordmark; its "c" is the work timer's ring. Plain <img>: next/image
 * adds an inline style attribute that the nonce CSP blocks.
 */
export function Logo({ size = "sm", tone = "on-light" }: LogoProps) {
  return (
    <span className="inline-flex shrink-0">
      <img
        src={SOURCES[tone]}
        alt={t("common.appName")}
        width={285}
        height={100}
        className={cx(SIZE_CLASSES[size])}
      />
    </span>
  );
}

/** The app tile (forest, white ring, lime dot): the logo where there is no room for the word. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/branding/cloxa-favicon.svg"
      alt={t("common.appName")}
      width={40}
      height={40}
      className={cx("size-10 shrink-0 rounded-control", className)}
    />
  );
}
