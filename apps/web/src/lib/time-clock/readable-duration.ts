export function readableDuration(microseconds: bigint) {
  if (microseconds > 0n && microseconds < 60_000_000n) return "Minder dan 1 min";
  const minutes = (microseconds > 0n ? microseconds : 0n) / 60_000_000n;
  return minutes < 60n
    ? `${minutes} min`
    : `${minutes / 60n} u ${String(minutes % 60n).padStart(2, "0")} min`;
}
