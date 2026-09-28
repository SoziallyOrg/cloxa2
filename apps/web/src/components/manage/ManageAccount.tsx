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
import { ChevronRight, Clock, ShieldCheck } from "lucide-react";

import { t } from "@cloxa/i18n";

import { SessionRows } from "../auth/SessionActions";
import { initials } from "../employee/account-name";
import { Row, Section } from "../ui/List";
import { Sheet } from "../ui/Sheet";

export interface ManageAccount {
  /** "Mia T.": the sidebar trigger. */
  shortName: string;
  /** "Mia Testmanager" (or the email when there is no employee row): the sheet title. */
  fullName: string;
  /** A manager who also clocks gets "Naar mijn klok". */
  canClock: boolean;
}

const AccountContext = createContext<(() => void) | null>(null);

// Managers never queue clock actions in /manage, so signing out never warns.
const NOTHING_QUEUED = () => Promise.resolve(0);

/**
 * The manager's account sheet: back to the own clock, security, and signing
 * out. One sheet for the whole `/manage` frame; it closes when a row
 * navigates away.
 */
export function ManageAccountProvider({
  account,
  children,
}: {
  account: ManageAccount;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState(pathname);

  if (open && openedOn !== pathname) setOpen(false);

  const openSheet = useCallback(() => {
    setOpenedOn(pathname);
    setOpen(true);
  }, [pathname]);

  const value = useMemo(() => openSheet, [openSheet]);

  return (
    <AccountContext value={value}>
      {children}
      <Sheet open={open} onClose={() => setOpen(false)} title={account.fullName}>
        <Section>
          {account.canClock ? (
            <Row href="/app" icon={Clock} title={t("manageNav.switchToEmployee")} />
          ) : null}
          <Row
            href="/manage/beveiliging/instellen"
            icon={ShieldCheck}
            title={t("manageNav.security")}
          />
        </Section>
        <SessionRows queuedCount={NOTHING_QUEUED} />
      </Sheet>
    </AccountContext>
  );
}

/** Initials and name at the bottom of the desktop sidebar; opens the account sheet. */
export function ManageAccountButton({ account }: { account: ManageAccount }) {
  const openSheet = use(AccountContext);
  if (!openSheet) throw new Error("ManageAccountButton needs a ManageAccountProvider");

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={openSheet}
      className="focus-ring flex min-h-touch-target w-full pressable items-center gap-3 rounded-list px-3 text-left text-body text-ink"
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-track text-footnote font-semibold text-ink"
      >
        {initials(account.fullName)}
      </span>
      <span className="min-w-0 flex-1 truncate">{account.shortName}</span>
      <ChevronRight
        aria-hidden="true"
        className="size-5 shrink-0 text-ink-3"
        strokeWidth={2.5}
      />
    </button>
  );
}

/** "Afmelden" and "Overal afmelden" for `/manage` pages (nothing is ever queued here). */
export function ManageSessionRows() {
  return <SessionRows queuedCount={NOTHING_QUEUED} />;
}
