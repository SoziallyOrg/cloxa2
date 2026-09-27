import { readableDuration } from "./readable-duration";
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
  return readableDuration(duration);
}
