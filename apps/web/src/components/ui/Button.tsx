import type { ButtonHTMLAttributes, ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { ActivityIndicator } from "./ActivityIndicator";
import { cx } from "./cx";

/**
 * `primary`: forest on light surfaces. `action`: lime with forest-deep text,
 * only on forest surfaces (the one main action there). `secondary`: outline.
 * `ghost-on-forest`: white at 14% on forest. `danger`: destructive. `plain`:
 * text only.
 */
export type ButtonVariant =
  "primary" | "action" | "secondary" | "ghost-on-forest" | "plain" | "danger";
/** `xl`: the Klok hero's action (76px). `lg`: main action (72px, full width). `md`: 56px, everything else. `sm`: 48px, compact (side panel). */
export type ButtonSize = "xl" | "lg" | "md" | "sm";

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

// `ghost-on-forest` and `action` carry `on-forest` so the focus ring turns lime.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-forest text-white",
  action: "on-forest bg-lime text-forest-deep",
  secondary: "border-[1.5px] border-line bg-card text-ink",
  "ghost-on-forest": "on-forest bg-white/14 text-white",
  plain: "text-ink",
  danger: "bg-danger text-white",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xl: "min-h-[76px] w-full rounded-clock text-title-2",
  lg: "min-h-primary-action w-full rounded-clock text-title-3",
  md: "min-h-control rounded-control text-headline",
  sm: "min-h-touch-target rounded-control text-callout font-bold",
};

/** Button looks for a link that navigates (never nest a `<button>` in an `<a>`). */
export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  wide = false,
): string {
  return cx(
    "pressable focus-ring inline-flex items-center justify-center gap-3 text-center select-none",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    variant === "plain" || size === "sm" ? "px-3" : "px-6",
    wide && "w-full",
  );
}

/**
 * The one interactive primitive every screen builds on. One main action per
 * screen. Dims while pressed. Disabled buttons keep readable text
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
