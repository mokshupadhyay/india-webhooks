import type { HeadersInput, HeadersLike } from './types.js';

const isHeadersLike = (headers: HeadersInput): headers is HeadersLike =>
  typeof (headers as HeadersLike).get === 'function';

/** Case-insensitive header lookup. Returns `null` when the header is absent or empty. */
export function readHeader(headers: HeadersInput | undefined, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  let value: string | null | undefined;
  if (isHeadersLike(headers)) {
    value = headers.get(name);
  } else {
    const wanted = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() !== wanted) continue;
      const raw = headers[key];
      value = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
      break;
    }
  }
  return typeof value === 'string' && value !== '' ? value : null;
}
