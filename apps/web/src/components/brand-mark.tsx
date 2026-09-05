import { cn } from "@/lib/utils";
import Image from "next/image";

type BrandWordmarkProps = {
  className?: string;
  variant?: "light" | "dark";
};

export function BrandMark({ className }: { className?: string }) {
  return (
    <Image
      aria-hidden="true"
      className={cn("h-8 w-auto", className)}
      height="32"
      src="/branding/cloxa-compact.svg"
      width="94"
      alt=""
    />
  );
}

export function BrandWordmark({ className, variant = "light" }: BrandWordmarkProps) {
  return (
    <Image
      aria-hidden="true"
      alt=""
      className={cn("h-auto w-44", className)}
      height="114"
      src={
        variant === "dark"
          ? "/branding/cloxa-on-dark.svg"
          : "/branding/cloxa-compact.svg"
      }
      width="334"
    />
  );
}
