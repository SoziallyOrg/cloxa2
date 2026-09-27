"use client";

import { useMemo, useState } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { IconSearch } from "../ui/icons";

export interface KioskEmployee {
  readonly id: string;
  readonly name: string;
}

export interface KioskHomeProps {
  employees: readonly KioskEmployee[];
  /** Called once 4 digits are entered. Resolve/settle to clear the pad. */
  onSubmitPin: (employeeId: string, pin: string) => void | Promise<void>;
}

const PIN_LENGTH = 4;
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
export function KioskHome({ employees, onSubmitPin }: KioskHomeProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<KioskEmployee | null>(null);
  const [pin, setPin] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return employees;
    return employees.filter((employee) => employee.name.toLowerCase().includes(needle));
  }, [employees, query]);

  function pressDigit(digit: string) {
    if (pin.length >= PIN_LENGTH || selected === null) return;
    const next = pin + digit;
    setPin(next);

    if (next.length === PIN_LENGTH) {
      void onSubmitPin(selected.id, next);
      setPin("");
    }
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

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((employee) => (
            <button
              key={employee.id}
              type="button"
              onClick={() => setSelected(employee)}
              className="focus-ring flex min-h-kiosk-tile w-full min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-3"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-contrast">
                {initialsOf(employee.name)}
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

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 p-6">
      <h1 className="text-2xl font-bold">{t("kiosk.pinTitle")}</h1>
      <p className="text-lg">{selected.name}</p>

      <div className="flex gap-3" aria-hidden="true">
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
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
        {pin.length}
      </p>

      <div className="grid grid-cols-3 gap-4">
        {DIGIT_ROWS.flat().map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => pressDigit(digit)}
            className="focus-ring size-pin-key rounded-lg border border-border bg-surface text-2xl font-bold"
          >
            {digit}
          </button>
        ))}
        <Button variant="quiet" size="md" onClick={() => setPin("")}>
          {t("kiosk.pinClear")}
        </Button>
        <button
          type="button"
          onClick={() => pressDigit(ZERO_DIGIT)}
          className="focus-ring size-pin-key rounded-lg border border-border bg-surface text-2xl font-bold"
        >
          {ZERO_DIGIT}
        </button>
        <Button
          variant="quiet"
          size="md"
          onClick={() => {
            setSelected(null);
            setPin("");
          }}
        >
          {t("kiosk.pinBack")}
        </Button>
      </div>
    </div>
  );
}
