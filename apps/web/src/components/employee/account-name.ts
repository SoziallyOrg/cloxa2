/** "Jan Janssens" → "Jan J."; a single name stays as it is. */
export function shortDisplayName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  const first = parts[0] ?? displayName;
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

/** "Jan Janssens" → "JJ", for the round avatar in the navigation bar. */
export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
