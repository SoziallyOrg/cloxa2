import Link from "next/link";
import type { Route } from "next";
import { SearchX } from "lucide-react";

import { t } from "@cloxa/i18n";

import { buttonClassName } from "./Button";

export interface NotFoundViewProps {
  /** Where the one button goes: the start of this area. */
  href: string;
  label: string;
}

/** "Pagina niet gevonden": an icon tile, one sentence and one way back. */
export function NotFoundView({ href, label }: NotFoundViewProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <span
        aria-hidden="true"
        className="mb-3 flex size-16 items-center justify-center rounded-clock bg-fill text-ink-2"
      >
        <SearchX className="size-8" strokeWidth={1.5} />
      </span>
      <h1 className="text-title">{t("errors.notFoundTitle")}</h1>
      <p className="max-w-sm text-body text-ink-2">{t("errors.notFoundBody")}</p>
      <div className="mt-4">
        <Link href={href as Route} className={buttonClassName("primary")}>
          {label}
        </Link>
      </div>
    </div>
  );
}
