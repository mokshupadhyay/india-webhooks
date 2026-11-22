import type { HeadersInput } from './types.js';

interface HeaderSources {
  entries?: unknown;
  forEach?: unknown;
  get?: unknown;
}

/**
 * Case-insensitive header lookup. Accepts Fetch `Headers`, a `Map`, any object
 * with `entries()` or `forEach`, an object with only `get`, or a plain object
 * such as Node's `req.headers`. For an array value the first entry is used.
 * Returns `null` when the header is absent or empty.
 */
export function readHeader(headers: HeadersInput | undefined, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const wanted = name.toLowerCase();
  const source = headers as HeaderSources;
  let found = false;
  let value: unknown;
  const consider = (key: unknown, raw: unknown) => {
    if (!found && typeof key === 'string' && key.toLowerCase() === wanted) {
      found = true;
      value = raw;
    }
  };

  if (typeof source.entries === 'function') {
    // Fetch `Headers`, `Map`, `URLSearchParams`-like objects.
    for (const entry of (source.entries as () => Iterable<unknown>).call(headers)) {
      if (Array.isArray(entry)) consider(entry[0], entry[1]);
      if (found) break;
    }
  } else if (typeof source.forEach === 'function') {
    (source.forEach as (callback: (raw: unknown, key: unknown) => void) => void).call(headers, (raw, key) =>
      consider(key, raw),
    );
  } else if (typeof source.get === 'function') {
    // Only a `get` to go on: trust it to be case-insensitive, as `Headers.get` is.
    value = (source.get as (name: string) => unknown).call(headers, name);
  } else {
    const record = headers as Readonly<Record<string, unknown>>;
    for (const key of Object.keys(record)) {
      consider(key, record[key]);
      if (found) break;
    }
  }

  const first = Array.isArray(value) ? (value as unknown[])[0] : value;
  return typeof first === 'string' && first !== '' ? first : null;
}
