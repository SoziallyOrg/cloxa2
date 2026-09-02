import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-8", className)}
      fill="none"
      viewBox="0 0 32 32"
    >
      <rect fill="currentColor" height="30" rx="7" width="30" x="1" y="1" />
      <path
        d="M9 10.5h14M9 16h8.5M9 21.5h5"
        stroke="var(--color-paper)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="m18.5 21 2.1 2 4.4-5"
        stroke="var(--color-signal)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.25"
      />
    </svg>
  );
}
