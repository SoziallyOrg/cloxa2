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
import { initials } from "./account-name";

export interface Account {
  employeeId: string;
  /** "Jan J.": the visible trigger. */
  shortName: string;
  /** "Jan Janssens": the sheet's title. */
  fullName: string;
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
          <Row href="/app/instellingen" icon={Settings} title={t("account.settings")} />
        </Section>
        <SessionRows queuedCount={() => queuedCountFor(account.employeeId)} />
      </Sheet>
    </AccountContext>
  );
}

/** The profile card on Ik: a forest tile with the initials, and the full name. */
export function AccountCard() {
  const { account } = useAccount();
  return (
    <div className="flex items-center gap-4 rounded-card bg-card p-4 shadow-card">
      <span
        aria-hidden="true"
        className="on-forest flex size-14 shrink-0 items-center justify-center rounded-clock bg-forest text-title-3 text-white"
      >
        {initials(account.fullName)}
      </span>
      <p className="min-w-0 text-title-3 break-words">{account.fullName}</p>
    </div>
  );
}

export interface AccountButtonProps {
  /**
   * `header`: the name, top right on Klok (phones). `bar`: the name as a
   * quiet trailing button in a navigation bar (phones). `sidebar`: initials
   * and name at the bottom of the desktop sidebar.
   */
  placement: "header" | "bar" | "sidebar";
}

/** Opens the account sheet. Always named after the person ("Jan J."). */
export function AccountButton({ placement }: AccountButtonProps) {
  const { account, openSheet } = useAccount();

  const avatar = (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-control bg-fill text-footnote font-bold text-forest"
    >
      {initials(account.fullName)}
    </span>
  );

  if (placement === "bar") {
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={openSheet}
        className="focus-ring -mr-1 min-h-bar-button max-w-[40vw] pressable truncate rounded-control px-2 text-body font-semibold text-ink-2 md:hidden"
      >
        {account.shortName}
      </button>
    );
  }

  if (placement === "sidebar") {
    return (
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={openSheet}
        className="focus-ring flex min-h-touch-target w-full pressable items-center justify-center gap-3 rounded-control px-2 text-left text-body font-semibold text-ink lg:justify-start"
      >
        {avatar}
        <span className="sr-only min-w-0 flex-1 truncate lg:not-sr-only">
          {account.shortName}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="hidden size-5 shrink-0 text-ink-3 lg:block"
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
      className="focus-ring -mr-3 min-h-touch-target max-w-[55vw] pressable truncate rounded-control px-3 text-body text-ink-2"
    >
      {account.shortName}
    </button>
  );
}
