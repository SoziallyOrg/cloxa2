import type { ButtonHTMLAttributes, ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { ActivityIndicator } from "./ActivityIndicator";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "plain" | "destructive";
/** `lg`: the screen's main action on phones (72px, full width). `md`: 52px. */
export type ButtonSize = "lg" | "md";

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretches an `md` button to the full width (e.g. stacked form actions). */
  wide?: boolean;
  /** Shows a spinner and disables the button, but keeps its label visible. */
  loading?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper",
  secondary: "border-[1.5px] border-line bg-paper text-ink",
  plain: "text-ink",
  destructive: "border-[1.5px] border-line bg-paper text-danger",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  lg: "min-h-primary-action w-full text-title-2 font-semibold",
  md: "min-h-control text-body font-semibold",
};

/** Button looks for a link that navigates (never nest a `<button>` in an `<a>`). */
export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  wide = false,
): string {
  return cx(
    "pressable focus-ring inline-flex items-center justify-center gap-3 rounded-control text-center select-none",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    variant === "plain" ? "px-3" : "px-6",
    wide && "w-full",
  );
}

/**
 * The one interactive primitive every screen builds on. One `primary` (solid
 * ink) per screen. Dims while pressed. Disabled buttons keep readable text
 * (never a faded grey) so seniors can still read why nothing happens.
 */
export function Button({
  variant = "primary",
  size = "md",
  wide = false,
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
        buttonClassName(variant, size, wide),
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      {loading ? <ActivityIndicator size="sm" /> : null}
      <span>{children}</span>
      {loading ? <span className="sr-only">{t("common.loading")}</span> : null}
    </button>
  );
}
