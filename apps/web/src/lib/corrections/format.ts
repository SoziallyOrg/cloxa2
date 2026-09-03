import { BELGIUM_TIME_ZONE } from "@/lib/time-clock/model";

const dateTimeFormatter = new Intl.DateTimeFormat("nl-BE", {
  day: "numeric",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "long",
  timeZone: BELGIUM_TIME_ZONE,
  weekday: "short",
  year: "numeric",
});

const inputFormatter = new Intl.DateTimeFormat("nl-BE", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: BELGIUM_TIME_ZONE,
  year: "numeric",
});

export function formatBelgianDateTime(timestamp: string) {
  return dateTimeFormatter.format(new Date(timestamp));
}

export function toBrusselsLocalInput(timestamp: string) {
  const values = Object.fromEntries(
    inputFormatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  // Date truncates microseconds. Keep the database fraction from the source text.
  const fraction = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/u
    .exec(timestamp)?.[1]
    ?.replace(/0+$/u, "");
  const seconds =
    values.second !== "00" || fraction
      ? `:${values.second}${fraction ? `.${fraction}` : ""}`
      : "";
  return `${values.day}/${values.month}/${values.year} ${values.hour}:${values.minute}${seconds}`;
}
