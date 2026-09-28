import { t } from "@cloxa/i18n";

import { cx } from "../ui/cx";

export interface LogoProps {
  /** `sm` for app headers, `lg` for login. */
  size?: "sm" | "lg";
}

const SIZE_CLASSES = {
  sm: "h-7 w-auto",
  lg: "h-9 w-auto",
} as const;

/**
 * The wordmark, switched for dark mode with CSS (both are tiny SVGs). Plain
 * <img>: next/image adds an inline style attribute that the nonce CSP blocks.
 */
export function Logo({ size = "sm" }: LogoProps) {
  return (
    <span className="inline-flex shrink-0">
      <img
        src="/branding/cloxa-logo.svg"
        alt={t("common.appName")}
        width={285}
        height={100}
        className={cx(SIZE_CLASSES[size], "dark:hidden")}
      />
      <img
        src="/branding/cloxa-logo-on-dark.svg"
        alt={t("common.appName")}
        width={285}
        height={100}
        className={cx(SIZE_CLASSES[size], "hidden dark:block")}
      />
    </span>
  );
}
