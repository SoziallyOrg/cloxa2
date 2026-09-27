import { IntlMessageFormat } from "intl-messageformat";

import { catalog, type Catalog } from "./catalog";

/** Union of every dotted path in the catalog that resolves to a string leaf. */
export type CatalogKey = DotPaths<Catalog>;

type DotPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : DotPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

function resolveMessage(key: string): string {
  const parts = key.split(".");
  let current: unknown = catalog;

  for (const part of parts) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      throw new Error(`Missing i18n key: "${key}"`);
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current !== "string") {
    throw new Error(`i18n key "${key}" does not resolve to a string.`);
  }

  return current;
}

/**
 * Look up a catalog message by its typed dotted key and, when the message
 * contains ICU placeholders, interpolate `values` via `intl-messageformat`.
 */
export function t(key: CatalogKey, values?: Record<string, string | number>): string {
  const message = resolveMessage(key);

  if (!values) {
    return message;
  }

  const formatter = new IntlMessageFormat(message, "nl-BE");
  return String(formatter.format(values));
}
