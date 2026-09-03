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
  const milliseconds = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  return `${hours} u ${minutes.toString().padStart(2, "0")} min`;
}
