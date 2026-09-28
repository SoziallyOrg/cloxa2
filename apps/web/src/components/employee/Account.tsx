"use client";

import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { ChevronRight, Settings } from "lucide-react";

import { t } from "@cloxa/i18n";

import { queuedCountFor } from "@/lib/offline/browser";

import { SessionRows } from "../auth/SessionActions";
import { Row, Section } from "../ui/List";
import { Sheet } from "../ui/Sheet";

export interface Account {
  employeeId: string;
  /** "Jan J.": the visible trigger. */
  shortName: string;
  /** "Jan Janssens": the sheet's title. */
  fullName: string;
}

/** "Jan Janssens" → "Jan J."; a single name stays as it is. */
export function shortDisplayName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  const first = parts[0] ?? displayName;
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

/** "Jan Janssens" → "JJ", for the round avatar in the navigation bar. */
export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

interface AccountContextValue {
  account: Account;
  openSheet: () => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

function useAccount(): AccountContextValue {
  const value = use(AccountContext);
  if (!value) throw new Error("AccountButton needs an AccountProvider");
  return value;
}

/**
 * The account sheet, shared by every trigger (the name on Klok, the avatar
 * in a navigation bar, the sidebar). One sheet for the whole `/app` frame;
 * it closes itself when a row navigates away.
 */
export function AccountProvider({
  account,
  children,
}: {
  account: Account;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState(pathname);

  // "Instellingen" navigates; the sheet lives in the layout, so it would stay.
  if (open && openedOn !== pathname) setOpen(false);

  const openSheet = useCallback(() => {
    setOpenedOn(pathname);
    setOpen(true);
  }, [pathname]);

  const value = useMemo(() => ({ account, openSheet }), [account, openSheet]);

  return (
    <AccountContext value={value}>
      {children}
      <Sheet open={open} onClose={() => setOpen(false)} title={account.fullName}>
        <Section>
          <Row
            href="/app/instellingen"
            icon={Settings}
            tile="gray"
            title={t("account.settings")}
          />
        </Section>
        <SessionRows queuedCount={() => queuedCountFor(account.employeeId)} />
      </Sheet>
    </AccountContext>
  );
}

export interface AccountButtonProps {
  /**
   * `header`: the name, top right on Klok (phones). `bar`: a round avatar in
   * a navigation bar (phones). `sidebar`: avatar and name at the bottom of
   * the desktop sidebar.
   */
  placement: "header" | "bar" | "sidebar";
}

/** Opens the account sheet. Always named after the person ("Jan J."). */
export function AccountButton({ placement }: AccountButtonProps) {
  const { account, openSheet } = useAccount();

  const avatar = (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-track text-footnote font-semibold text-ink"
    >
      {initials(account.fullName)}
    </span>
  );

  if (placement === "bar") {
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={account.shortName}
        onClick={openSheet}
        className="focus-ring inline-flex size-bar-button items-center justify-center rounded-full pressable md:hidden"
      >
        {avatar}
      </button>
    );
  }

  if (placement === "sidebar") {
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={openSheet}
        className="focus-ring flex min-h-touch-target w-full items-center gap-3 rounded-list px-3 text-left text-body text-ink pressable"
      >
        {avatar}
        <span className="min-w-0 flex-1 truncate">{account.shortName}</span>
        <ChevronRight
          aria-hidden="true"
          className="size-5 shrink-0 text-ink-3"
          strokeWidth={2.5}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={openSheet}
      className="focus-ring -mr-3 min-h-touch-target max-w-[55vw] truncate rounded-control px-3 text-body text-ink-2 pressable"
    >
      {account.shortName}
    </button>
  );
}
