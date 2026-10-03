"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { t } from "@cloxa/i18n";

import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { KioskShell } from "./KioskShell";

export interface KioskEmployee {
  readonly id: string;
  readonly name: string;
  /** From the database; derived from the name when absent (preview data). */
  readonly initials?: string;
  /** `false` shows "no PIN yet" instead of the pad. */
  readonly hasPin?: boolean;
}

export interface KioskHomeProps {
  employees: readonly KioskEmployee[];
  /** The tapped tile, or null for the name grid. Owned by the caller. */
  selected: KioskEmployee | null;
  onSelect: (employee: KioskEmployee | null) => void;
  /** Called with 4 to 6 digits when OK is pressed. The pad clears itself. */
  onSubmitPin: (employeeId: string, pin: string) => void | Promise<void>;
  /** While the PIN is being checked. */
  busy?: boolean;
  /** Shown above the pad, e.g. a wrong PIN. */
  error?: string | null;
}

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 6;
const SEARCH_THRESHOLD = 12;
const ZERO_DIGIT = "0";
const DIGIT_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
] as const;

function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/** A wall-mounted tablet flow: pick your name, then enter your pincode. */
export function KioskHome({
  employees,
  selected,
  onSelect,
  onSubmitPin,
  busy = false,
  error = null,
}: KioskHomeProps) {
  const [query, setQuery] = useState("");
  const [pin, setPin] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return employees;
    return employees.filter((employee) => employee.name.toLowerCase().includes(needle));
  }, [employees, query]);

  function pressDigit(digit: string) {
    if (busy || pin.length >= PIN_MAX_LENGTH) return;
    setPin(pin + digit);
  }

  function submit() {
    if (busy || selected === null || pin.length < PIN_MIN_LENGTH) return;
    void onSubmitPin(selected.id, pin);
    setPin("");
  }

  function back() {
    setPin("");
    setQuery("");
    onSelect(null);
  }

  if (selected === null) {
    return (
      <KioskShell tagline className="items-center">
        <div className="flex w-full max-w-5xl flex-col gap-6 p-6 md:p-8">
          <h1 className="text-large-title">{t("kiosk.chooseEmployee")}</h1>

          {employees.length > SEARCH_THRESHOLD ? (
            <label className="flex min-h-16 items-center gap-3 rounded-clock border-[1.5px] border-field bg-card px-5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-forest">
              <Search aria-hidden="true" className="size-6 text-ink-2" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("kiosk.searchPlaceholder")}
                aria-label={t("common.search")}
                className="w-full bg-transparent text-body outline-none placeholder:text-ink-2"
              />
            </label>
          ) : null}

          {employees.length === 0 ? (
            <div className="rounded-card bg-card p-8 text-center shadow-card">
              <p className="text-body">{t("kiosk.noEmployees")}</p>
            </div>
          ) : null}

          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map((employee) => (
              <li key={employee.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    setPin("");
                    onSelect(employee);
                  }}
                  className="focus-ring flex h-full min-h-kiosk-tile w-full min-w-0 pressable flex-col items-center justify-center gap-3 rounded-clock bg-card p-4 shadow-card"
                >
                  <span
                    aria-hidden="true"
                    className="on-forest flex size-14 shrink-0 items-center justify-center rounded-clock bg-forest text-title-3 text-white"
                  >
                    {employee.initials ?? initialsOf(employee.name)}
                  </span>
                  <span className="line-clamp-2 w-full text-center text-title-3 break-words">
                    {employee.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </KioskShell>
    );
  }

  if (selected.hasPin === false) {
    return (
      <KioskShell className="items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-hero bg-card p-8 text-center shadow-card">
          <h1 className="text-title-1">{selected.name}</h1>
          <p className="text-body">{t("kiosk.noPin")}</p>
          <Button variant="secondary" size="lg" onClick={back}>
            {t("kiosk.pinBack")}
          </Button>
        </div>
      </KioskShell>
    );
  }

  const slots = Math.max(PIN_MIN_LENGTH, pin.length);

  return (
    <KioskShell className="items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-hero bg-card p-6 shadow-card md:p-8">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-title-1">{t("kiosk.pinTitle")}</h1>
          <p className="text-title-3 text-ink-2">{selected.name}</p>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="flex h-5 gap-3" aria-hidden="true">
          {Array.from({ length: slots }, (_, index) => (
            <span
              key={index}
              className={cx(
                "size-5 rounded-full border-2 border-forest",
                index < pin.length ? "bg-forest" : "bg-transparent",
              )}
            />
          ))}
        </div>
        <p className="sr-only" role="status">
          {t("kiosk.pinEntered", { count: pin.length })}
        </p>

        <div className="grid w-full grid-cols-3 gap-3">
          {DIGIT_ROWS.flat().map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={busy}
              onClick={() => pressDigit(digit)}
              className={PIN_KEY}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => setPin("")}
            className={cx(PIN_KEY, "text-title-3")}
          >
            {t("kiosk.pinClear")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => pressDigit(ZERO_DIGIT)}
            className={PIN_KEY}
          >
            {ZERO_DIGIT}
          </button>
          <button
            type="button"
            aria-busy={busy || undefined}
            disabled={busy || pin.length < PIN_MIN_LENGTH}
            onClick={submit}
            className="focus-ring on-forest min-h-pin-key w-full pressable rounded-clock bg-forest text-title-1 text-white disabled:cursor-not-allowed disabled:bg-idle disabled:text-ink [@media(max-height:840px)]:min-h-primary-action"
          >
            {t("kiosk.pinConfirm")}
          </button>
        </div>

        <Button variant="secondary" size="md" wide onClick={back}>
          {t("kiosk.pinBack")}
        </Button>
      </div>
    </KioskShell>
  );
}

/** Large round-rect keys (88px) on the white pad card: easy with gloves and cold hands. */
const PIN_KEY =
  "focus-ring pressable min-h-pin-key w-full rounded-clock border-[1.5px] border-line bg-paper text-title-1 disabled:cursor-not-allowed disabled:opacity-60 [@media(max-height:840px)]:min-h-primary-action";
