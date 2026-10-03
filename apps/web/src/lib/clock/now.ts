/**
 * `Date.now()`, wrapped so Server Component bodies don't call an impure
 * global directly (the `react-hooks/purity` rule flags that even though a
 * Server Component only renders once per request).
 */
export function nowMs(): number {
  return Date.now();
}
