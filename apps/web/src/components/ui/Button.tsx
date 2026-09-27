import type { ButtonHTMLAttributes, ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "danger" | "quiet";
export type ButtonSize = "md" | "lg" | "xl";

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button, but keeps its label visible. */
  loading?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-contrast border border-primary",
  secondary: "bg-surface text-ink border-2 border-primary",
  danger: "bg-surface text-status-error border-2 border-status-error",
  quiet: "bg-transparent text-ink border border-border",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "min-h-touch-target px-6 text-lg",
  lg: "min-h-button-lg px-6 text-lg",
  xl: "min-h-primary-action w-full px-8 text-2xl",
};

/**
 * The one interactive primitive every screen builds on. Disabled buttons
 * keep full-contrast text (never a faded grey) so seniors can still read
 * why nothing happens.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "focus-ring inline-flex items-center justify-center gap-3 rounded-md font-semibold",
        "disabled:cursor-not-allowed disabled:opacity-70",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
      )}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      <span>{children}</span>
      {loading ? <span className="sr-only">{t("common.loading")}</span> : null}
    </button>
  );
}
