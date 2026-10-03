import Link from "next/link";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";
import { POP } from "./transitions";

export type NavBarBack =
  | { href: string; label: string; onClick?: never }
  | { onClick: () => void; label: string; href?: never };

export interface NavBarProps {
  /** The page title (the page's `h1`). */
  title: string;
  /**
   * Pushed pages: a chevron plus the previous page's title. A link, or a
   * button for steps within one page (the correction wizard).
   */
  back?: NavBarBack;
  /** Page actions, right of the title on desktop: `NavBarButton`s. */
  trailing?: ReactNode;
  /** One quiet line under the title, e.g. today's date. */
  subtitle?: ReactNode;
  /** Kept for existing call sites; every page now sits on paper. */
  tone?: "grouped" | "plain";
  /** Kept for existing call sites; the frame (`SidebarLayout`) sets the column width. */
  wide?: boolean;
}

/**
 * The page header: a back link when pushed, the title with a quiet subtitle,
 * and the page actions on the right. A plain server component: no sticky or
 * translucent bar, the page just scrolls.
 */
export function NavBar({ title, back, trailing, subtitle }: NavBarProps) {
  return (
    <header className="flex w-full flex-col gap-2 px-gutter pt-3 pb-5 md:px-gutter-desktop md:pt-8">
      {back ? (
        <div className="-ml-3">
          <BackButton {...back} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-large-title break-words md:text-[40px] md:leading-[44px]">
            {title}
          </h1>
          {subtitle ? <p className="text-subhead text-ink-2">{subtitle}</p> : null}
        </div>
        {trailing ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{trailing}</div>
        ) : null}
      </div>
    </header>
  );
}

const BACK =
  "focus-ring flex min-h-bar-button max-w-full min-w-0 items-center rounded-control pr-3 text-body font-bold text-forest pressable";

function BackButton({ href, onClick, label }: NavBarBack) {
  const content = (
    <>
      <ChevronLeft aria-hidden="true" className="size-7 shrink-0" strokeWidth={2.25} />
      <span className="-ml-0.5 truncate">{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={BACK}>
        {content}
      </button>
    );
  }
  return (
    <Link href={href as Route} transitionTypes={POP} className={BACK}>
      {content}
    </Link>
  );
}

type NavBarButtonBase = {
  /** Emphasised (forest), for the confirming action such as "Klaar". */
  strong?: boolean;
};

type NavBarTextButton = NavBarButtonBase & {
  children: string;
  icon?: never;
  label?: never;
};
type NavBarIconButton = NavBarButtonBase & {
  icon: LucideIcon;
  /** The accessible name of an icon-only button. */
  label: string;
  children?: never;
};

export type NavBarButtonProps = (NavBarTextButton | NavBarIconButton) &
  (
    | ({ href: string } & { type?: never; onClick?: never })
    | ({ href?: never } & Omit<
        ButtonHTMLAttributes<HTMLButtonElement>,
        "className" | "children"
      >)
  );

/** A page action: text ("Klaar", "Bewerk") or an icon, 48px target. */
export function NavBarButton(props: NavBarButtonProps) {
  const { strong = false, icon: Icon, label, children, ...rest } = props;
  const className = cx(
    "pressable focus-ring inline-flex min-h-bar-button min-w-bar-button items-center justify-center rounded-control px-4 text-body font-bold",
    strong ? "bg-forest text-white" : "border-[1.5px] border-line bg-card text-ink",
  );
  const content = Icon ? (
    <Icon aria-hidden="true" className="size-6" strokeWidth={2} />
  ) : (
    children
  );

  if ("href" in rest && rest.href !== undefined) {
    return (
      <Link href={rest.href as Route} aria-label={label} className={className}>
        {content}
      </Link>
    );
  }
  const { type = "button", ...button } =
    rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button {...button} type={type} aria-label={label} className={className}>
      {content}
    </button>
  );
}
