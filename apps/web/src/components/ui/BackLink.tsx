import Link from "next/link";
import type { Route } from "next";

export interface BackLinkProps {
  href: string;
  /** Where it goes, e.g. "Instellingen". */
  label: string;
}

/** A quiet "‹ Instellingen" link above a page title. */
export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Link
      href={href as Route}
      className="focus-ring -ml-2 inline-flex min-h-touch-target items-center gap-1.5 self-start rounded-control px-2 text-body text-ink-2 pressable"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 8 14"
        className="h-3.5 w-2"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 1 1 7l6 6" />
      </svg>
      <span>{label}</span>
    </Link>
  );
}
