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

import { queuedCountFor } from "@/lib/offline/browser";

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
  /** Their own employee row: the clock bar can queue clock actions for it. */
  employeeId: string | null;
}

interface AccountContextValue {
  openSheet: () => void;
  employeeId: string | null;
}

const AccountContext = createContext<AccountContextValue | null>(null);

const NOTHING_QUEUED = () => Promise.resolve(0);

/** Signing out warns about clock actions the clock bar still has queued on this device. */
function useQueuedCount(): () => Promise<number> {
  const context = use(AccountContext);
  const employeeId = context?.employeeId ?? null;
  return employeeId === null ? NOTHING_QUEUED : () => queuedCountFor(employeeId);
}

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

  const value = useMemo(
    () => ({ openSheet, employeeId: account.employeeId }),
    [openSheet, account.employeeId],
  );

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
        <SheetSessionRows />
      </Sheet>
    </AccountContext>
  );
}

/** Initials and name at the bottom of the desktop sidebar; opens the account sheet. */
export function ManageAccountButton({ account }: { account: ManageAccount }) {
  const openSheet = use(AccountContext)?.openSheet;
  if (!openSheet) throw new Error("ManageAccountButton needs a ManageAccountProvider");

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={openSheet}
      className="focus-ring flex min-h-touch-target w-full pressable items-center justify-center gap-3 rounded-control px-2 text-left text-body font-semibold text-ink lg:justify-start"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fill text-footnote font-bold text-forest"
      >
        {initials(account.fullName)}
      </span>
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

/** "Afmelden" and "Overal afmelden" for `/manage` pages. */
export function ManageSessionRows() {
  return <SessionRows queuedCount={useQueuedCount()} />;
}

function SheetSessionRows() {
  return <SessionRows queuedCount={useQueuedCount()} />;
}
