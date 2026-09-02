import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border text-sm font-semibold transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-out outline-none focus-visible:ring-3 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-55 motion-safe:active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border-primary bg-primary px-5 text-primary-foreground shadow-[0_8px_20px_-14px_var(--color-ink)] hover:border-primary-strong hover:bg-primary-strong",
        secondary:
          "border-rule-strong bg-paper px-5 text-ink hover:border-ink hover:bg-paper-strong",
        quiet:
          "border-transparent bg-transparent px-3 text-primary hover:bg-primary-soft hover:text-primary-strong",
      },
      size: {
        default: "h-11",
        large: "h-12 px-6 text-base",
        icon: "size-11 p-0",
      },
    },
    defaultVariants: {
      size: "default",
      variant: "primary",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  asChild = false,
  className,
  size,
  variant,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(buttonVariants({ className, size, variant }))}
      {...props}
    />
  );
}
