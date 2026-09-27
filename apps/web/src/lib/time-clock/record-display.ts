import { minuteInput, knownOccurrence } from "@/lib/corrections/local-time";

function endpoint(value: string, includeDate: boolean) {
  const local = minuteInput(value);
  const occurrence = knownOccurrence(value);
  return `${includeDate ? local : local.slice(11)}${occurrence ? (occurrence === "earlier" ? " (eerste keer)" : " (tweede keer)") : ""}`;
}
export function recordRange(start: string, end: string | null, includeDate = false) {
  const overnight =
    !!end && minuteInput(start).slice(0, 10) !== minuteInput(end).slice(0, 10);
  return `${endpoint(start, includeDate || overnight)}–${end ? endpoint(end, overnight) : "Bezig"}`;
}
