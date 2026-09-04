import { exactMicroseconds } from "./breaks";
import { BELGIUM_TIME_ZONE } from "@/lib/time-clock/model";

const timeFormatter = new Intl.DateTimeFormat("nl-BE", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: BELGIUM_TIME_ZONE,
});

const dateFormatter = new Intl.DateTimeFormat("nl-BE", {
  day: "numeric",
  month: "long",
  timeZone: BELGIUM_TIME_ZONE,
  weekday: "long",
});

export function formatBelgianTime(timestamp: string) {
  return timeFormatter.format(new Date(timestamp));
}

export function formatBelgianDate(timestamp: string) {
  return dateFormatter.format(new Date(timestamp));
}

export function formatDuration(startedAt: string, endedAt: string) {
  const duration = exactMicroseconds(endedAt) - exactMicroseconds(startedAt);
  const totalMinutes = (duration < 0n ? 0n : duration) / 60_000_000n;
  const hours = totalMinutes / 60n;
  const minutes = totalMinutes % 60n;

  if (hours === 0n) {
    return `${minutes} min`;
  }

  return `${hours} u ${minutes.toString().padStart(2, "0")} min`;
}
