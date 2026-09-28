"use client";

import { useMemo, useState } from "react";

import { t } from "@cloxa/i18n";

import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { IconSearch } from "../ui/icons";

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
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        <h1 className="text-2xl font-bold">{t("kiosk.chooseEmployee")}</h1>

        {employees.length > SEARCH_THRESHOLD ? (
          <label className="flex items-center gap-3 rounded-md border-2 border-border bg-surface px-4 py-3">
            <IconSearch />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("kiosk.searchPlaceholder")}
              aria-label={t("common.search")}
              className="focus-ring w-full text-lg"
            />
          </label>
        ) : null}

        {employees.length === 0 ? (
          <p className="text-lg">{t("kiosk.noEmployees")}</p>
        ) : null}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((employee) => (
            <button
              key={employee.id}
              type="button"
              onClick={() => {
                setPin("");
                onSelect(employee);
              }}
              className="focus-ring flex min-h-kiosk-tile w-full min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-3"
            >
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-contrast"
              >
                {employee.initials ?? initialsOf(employee.name)}
              </span>
              <span className="line-clamp-2 w-full text-center text-base font-semibold break-words">
                {employee.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (selected.hasPin === false) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 p-6">
        <h1 className="text-2xl font-bold">{selected.name}</h1>
        <p className="text-center text-lg">{t("kiosk.noPin")}</p>
        <Button variant="secondary" size="lg" onClick={back}>
          {t("kiosk.pinBack")}
        </Button>
      </div>
    );
  }

  const slots = Math.max(PIN_MIN_LENGTH, pin.length);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 p-6">
      <h1 className="text-2xl font-bold">{t("kiosk.pinTitle")}</h1>
      <p className="text-lg">{selected.name}</p>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex gap-3" aria-hidden="true">
        {Array.from({ length: slots }, (_, index) => (
          <span
            key={index}
            className={cx(
              "size-4 rounded-full border-2 border-primary",
              index < pin.length ? "bg-primary" : "bg-transparent",
            )}
          />
        ))}
      </div>
      <p className="sr-only" role="status">
        {t("kiosk.pinEntered", { count: pin.length })}
      </p>

      <div className="grid grid-cols-3 gap-4">
        {DIGIT_ROWS.flat().map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={busy}
            onClick={() => pressDigit(digit)}
            className="focus-ring size-pin-key rounded-lg border border-border bg-surface text-2xl font-bold"
          >
            {digit}
          </button>
        ))}
        <Button variant="quiet" size="md" disabled={busy} onClick={() => setPin("")}>
          {t("kiosk.pinClear")}
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={() => pressDigit(ZERO_DIGIT)}
          className="focus-ring size-pin-key rounded-lg border border-border bg-surface text-2xl font-bold"
        >
          {ZERO_DIGIT}
        </button>
        <Button
          variant="primary"
          size="md"
          loading={busy}
          disabled={pin.length < PIN_MIN_LENGTH}
          onClick={submit}
        >
          {t("kiosk.pinConfirm")}
        </Button>
      </div>

      <Button variant="quiet" size="md" onClick={back}>
        {t("kiosk.pinBack")}
      </Button>
    </div>
  );
}
