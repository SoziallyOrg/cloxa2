import Link from "next/link";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "./cx";
import { NavBarFrame } from "./NavBarFrame";
import { POP } from "./transitions";

export type NavBarBack =
  | { href: string; label: string; onClick?: never }
  | { onClick: () => void; label: string; href?: never };

export interface NavBarProps {
  /** The page title: large under the bar, inline once scrolled. */
  title: string;
  /**
   * Pushed pages: a chevron plus the previous page's title. A link, or a
   * button for steps within one page (the correction wizard).
   */
  back?: NavBarBack;
  /** `NavBarButton`s, e.g. "Klaar" or an icon button. */
  trailing?: ReactNode;
  /** One quiet line under the large title, e.g. today's date. */
  subtitle?: ReactNode;
  /** The page background, so the bar blends in before it collapses. */
  tone?: "grouped" | "plain";
  /** Full-width pages (the timeline); lists keep the readable column. */
  wide?: boolean;
}

/**
 * The iOS navigation bar with a large title. Renders on the server; only the
 * collapse-on-scroll is a small client island (`NavBarFrame`).
 */
export function NavBar({
  title,
  back,
  trailing,
  subtitle,
  tone = "grouped",
  wide = false,
}: NavBarProps) {
  return (
    <NavBarFrame
      title={title}
      tone={tone}
      wide={wide}
      leading={back ? <BackButton {...back} /> : null}
      trailing={trailing}
    >
      <div className="flex flex-col gap-1 px-inset pt-1 pb-3">
        <h1 className="text-large-title break-words">{title}</h1>
        {subtitle ? <p className="text-subhead text-ink-2">{subtitle}</p> : null}
      </div>
    </NavBarFrame>
  );
}

const BACK =
  "focus-ring flex h-bar-button max-w-full min-w-0 items-center rounded-control pr-2 text-body text-ink pressable";

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
  /** Emphasised (semibold), for the confirming action such as "Klaar". */
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

/** A trailing bar action: text ("Klaar", "Bewerk") or an icon, 44px target. */
export function NavBarButton(props: NavBarButtonProps) {
  const { strong = false, icon: Icon, label, children, ...rest } = props;
  const className = cx(
    "pressable focus-ring inline-flex h-bar-button min-w-bar-button items-center justify-center rounded-control px-2 text-body text-ink",
    strong && "font-semibold",
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
