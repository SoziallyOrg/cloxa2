/** Tiny classnames joiner so we don't add a dependency for this. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
