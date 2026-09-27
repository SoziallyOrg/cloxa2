import { toBrusselsLocalInput, formatBelgianDateTime } from "@/lib/corrections/format";
import { formatExactDuration } from "@/lib/time-clock/breaks";
import { readableDuration } from "@/lib/time-clock/readable-duration";
import { knownOccurrence } from "@/lib/corrections/local-time";

export function DurationDetails({ value }: { value: bigint }) {
  return (
    <div className="min-w-0 tabular-nums">
      <span>{readableDuration(value)}</span>
      {value % 60_000_000n !== 0n && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer py-2">Exacte duur</summary>
          <span className="break-words">{formatExactDuration(value)}</span>
        </details>
      )}
    </div>
  );
}
export function TimeDetails({ value }: { value: string }) {
  return (
    <div className="min-w-0 tabular-nums">
      <time dateTime={value}>{formatBelgianDateTime(value)}</time>
      {(toBrusselsLocalInput(value).length > 16 || knownOccurrence(value)) && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer py-2">Exact tijdstip</summary>
          <span className="break-words">
            {toBrusselsLocalInput(value)} ·{" "}
            {
              new Intl.DateTimeFormat("nl-BE", {
                timeZone: "Europe/Brussels",
                timeZoneName: "shortOffset",
              })
                .formatToParts(new Date(value))
                .find((p) => p.type === "timeZoneName")?.value
            }
          </span>
        </details>
      )}
    </div>
  );
}
