import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { AppliedCorrections } from "./applied-corrections";
import { StatusBadge } from "./ui/status-badge";
import type { EntryProvenance } from "@/lib/corrections/provenance";
import {
  factualTotals,
  formatExactDuration,
  type TimeBreak,
} from "@/lib/time-clock/breaks";
import { readableDuration } from "@/lib/time-clock/readable-duration";
import { recordRange } from "@/lib/time-clock/record-display";
import { toBrusselsLocalInput } from "@/lib/corrections/format";

function ExactTime({ value }: { value: string }) {
  const offset = new Intl.DateTimeFormat("nl-BE", {
    timeZone: "Europe/Brussels",
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(value))
    .find((p) => p.type === "timeZoneName")?.value;
  return (
    <time dateTime={value}>
      {toBrusselsLocalInput(value)} · {offset}
    </time>
  );
}
export function RegistrationRecord({
  entry,
  provenance,
  includeDate = false,
  action,
}: {
  entry: { id: string; startedAt: string; endedAt: string | null; breaks: TimeBreak[] };
  provenance?: EntryProvenance | undefined;
  includeDate?: boolean;
  action?: ReactNode;
}) {
  const totals = factualTotals(entry.startedAt, entry.endedAt, entry.breaks);
  const values = [
    ["Bruto", totals.gross],
    ["Pauze", totals.completedBreak],
    ["Netto", totals.net],
  ] as const;
  return (
    <div className="registration-record">
      <CheckCircle2 aria-hidden="true" className="record-icon" size={20} />
      <div className="record-body">
        <div className="record-heading">
          <p className="font-semibold tabular-nums">
            {recordRange(entry.startedAt, entry.endedAt, includeDate)}
          </p>
          <StatusBadge status={entry.endedAt ? "neutral" : "information"}>
            {entry.endedAt
              ? "Afgesloten"
              : entry.breaks.some((b) => !b.endedAt)
                ? "Met pauze"
                : "Bezig"}
          </StatusBadge>
        </div>
        <dl className="record-totals">
          {values.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value === null ? "Nog open" : readableDuration(value)}</dd>
            </div>
          ))}
        </dl>
        {entry.breaks.length > 0 && (
          <p className="record-breaks">
            <span className="font-semibold">Pauzes: </span>
            {entry.breaks.map((b, i) => (
              <span key={b.id}>
                {i > 0 ? "; " : ""}
                {recordRange(b.startedAt, b.endedAt)}
              </span>
            ))}
          </p>
        )}
        <AppliedCorrections provenance={provenance} />
        <details className="record-details">
          <summary>Details van registratie</summary>
          <p className="mb-3 text-sm text-muted">
            Overzicht toont minuten. Totalen zijn berekend met exacte tijdstippen;
            zichtbare eindpunten hoeven die duur niet exact te reconstrueren. Bij een
            open werkperiode tellen alleen afgeronde pauzes mee.
          </p>
          <dl className="record-exact">
            <div>
              <dt>Start</dt>
              <dd>
                <ExactTime value={entry.startedAt} />
              </dd>
            </div>
            <div>
              <dt>Einde</dt>
              <dd>
                {entry.endedAt ? <ExactTime value={entry.endedAt} /> : "Nog open"}
              </dd>
            </div>
            {values.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value === null ? "Nog open" : formatExactDuration(value)}</dd>
              </div>
            ))}
          </dl>
          {entry.breaks.length > 0 && (
            <ol className="mt-3 space-y-3">
              {entry.breaks.map((b, i) => (
                <li key={b.id}>
                  <p className="font-semibold">
                    Pauze {i + 1} · versie {b.version}
                  </p>
                  <p>
                    <ExactTime value={b.startedAt} />
                  </p>
                  <p>{b.endedAt ? <ExactTime value={b.endedAt} /> : "Nog open"}</p>
                </li>
              ))}
            </ol>
          )}
        </details>
      </div>
      {action && <div className="record-action">{action}</div>}
    </div>
  );
}
