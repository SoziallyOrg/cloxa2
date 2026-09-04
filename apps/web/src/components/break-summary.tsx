import { nlBE } from "@/i18n/nl-BE";
import { toBrusselsLocalInput } from "@/lib/corrections/format";
import {
  factualTotals,
  formatExactDuration,
  type TimeBreak,
} from "@/lib/time-clock/breaks";

export function BreakSummary({
  breaks,
  start,
  end,
}: {
  breaks: TimeBreak[];
  start?: string;
  end?: string | null;
}) {
  const totals = start ? factualTotals(start, end ?? null, breaks) : null;
  return (
    <div className="mt-3 min-w-0 text-sm text-ink" data-testid="break-summary">
      {breaks.length > 0 ? (
        <>
          <p className="font-semibold">{nlBE.breaks.summary}</p>
          <ol className="mt-2 space-y-2">
            {breaks.map((b) => (
              <li key={b.id} className="break-words tabular-nums">
                <time dateTime={b.startedAt}>{toBrusselsLocalInput(b.startedAt)}</time>
                {" – "}
                {b.endedAt ? (
                  <time dateTime={b.endedAt}>{toBrusselsLocalInput(b.endedAt)}</time>
                ) : (
                  nlBE.breaks.open
                )}
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {totals ? (
        <dl className="mt-3 space-y-1 tabular-nums">
          {[
            [nlBE.breaks.gross, totals.gross],
            [nlBE.breaks.completed, totals.completedBreak],
            [nlBE.breaks.net, totals.net],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt className="font-semibold">{label}</dt>
              <dd>
                {typeof value === "bigint"
                  ? formatExactDuration(value)
                  : nlBE.breaks.open}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
