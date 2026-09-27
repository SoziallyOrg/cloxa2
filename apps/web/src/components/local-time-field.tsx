"use client";

import { useState } from "react";
import { toBrusselsLocalInput } from "@/lib/corrections/format";
import {
  knownOccurrence,
  localTimeCandidates,
  minuteInput,
  type Occurrence,
} from "@/lib/corrections/local-time";

export function LocalTimeField({
  name,
  occurrenceName = `${name}_occurrence`,
  label,
  instant,
  disabled,
  error,
}: {
  name: string;
  occurrenceName?: string;
  label: string;
  instant?: string | undefined;
  disabled?: boolean;
  error?: string | undefined;
}) {
  const [value, setValue] = useState(instant ? minuteInput(instant) : "");
  const [untouched, setUntouched] = useState(Boolean(instant));
  const [occurrence, setOccurrence] = useState<Occurrence>(
    instant ? knownOccurrence(instant) : "",
  );
  const candidates = localTimeCandidates(value);
  const gap = candidates?.length === 0;
  const message = gap
    ? "Dit tijdstip bestaat niet door de overgang naar zomertijd. Kies een tijd vóór 02:00 of vanaf 03:00."
    : error;
  return (
    <div className="min-w-0">
      <label className="block text-sm font-semibold" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        className="time-field"
        value={value}
        disabled={disabled}
        required
        placeholder="dd/mm/jjjj uu:mm"
        autoComplete="off"
        pattern={String.raw`[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}`}
        aria-invalid={Boolean(message)}
        aria-describedby={`${name}-help ${name}-error`}
        onChange={(event) => {
          setValue(event.target.value);
          setUntouched(false);
          setOccurrence("");
        }}
      />
      <input
        type="hidden"
        name={`${name}_expected`}
        value={untouched ? (instant ?? "") : ""}
      />
      {candidates?.length === 2 ? (
        <div className="mt-3 border-l-2 border-primary pl-3">
          <p className="text-sm">
            Door de overgang naar wintertijd komt dit tijdstip twee keer voor.
          </p>
          <label className="mt-2 block text-sm font-semibold" htmlFor={occurrenceName}>
            {label}: welk tijdstip?
          </label>
          <select
            id={occurrenceName}
            name={occurrenceName}
            className="time-field"
            value={occurrence}
            required
            disabled={disabled}
            onChange={(event) => {
              setOccurrence(event.target.value as Occurrence);
              setUntouched(false);
            }}
          >
            <option value="">Kies een tijdstip</option>
            <option value="earlier">Eerste keer · zomertijd (UTC+02:00)</option>
            <option value="later">Tweede keer · wintertijd (UTC+01:00)</option>
          </select>
        </div>
      ) : (
        <input type="hidden" name={occurrenceName} value="" />
      )}
      <p id={`${name}-help`} className="mt-2 text-xs leading-5 text-muted">
        {untouched
          ? "Ongewijzigd: exacte geregistreerde tijd blijft behouden."
          : "Brusselse tijd. Een wijziging geldt op de minuut, met seconden op 00."}
      </p>
      {instant && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer py-2">Exacte oorspronkelijke tijd</summary>
          <p className="break-words">
            {toBrusselsLocalInput(instant)} ·{" "}
            {knownOccurrence(instant) === "later"
              ? "wintertijd, tweede keer"
              : knownOccurrence(instant) === "earlier"
                ? "zomertijd, eerste keer"
                : "Brussel"}
          </p>
        </details>
      )}
      <p id={`${name}-error`} className="mt-2 text-sm text-danger">
        {message}
      </p>
    </div>
  );
}
