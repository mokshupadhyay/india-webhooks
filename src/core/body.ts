import { decodeUtf8, decodeUtf8Strict, utf8 } from './bytes.js';
import type { JsonObject, JsonValue } from './types.js';

interface UrlSearchParamsLike {
  append(name: string, value: string): void;
  forEach(callback: (value: string, key: string) => void): void;
  toString(): string;
}

const URLSearchParamsCtor = (globalThis as unknown as { URLSearchParams: new (init?: string) => UrlSearchParamsLike })
  .URLSearchParams;

/** Encodes fields as `application/x-www-form-urlencoded`, in insertion order. */
export function encodeForm(fields: Readonly<Record<string, string>>): string {
  const params = new URLSearchParamsCtor();
  for (const key of Object.keys(fields)) params.append(key, fields[key]);
  return params.toString();
}

const arrayBufferByteLength = (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength') as PropertyDescriptor)
  .get as (this: unknown) => number;

/** True for a real `ArrayBuffer`, from this realm or another (workers, vm contexts). */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  if (typeof value !== 'object' || value === null) return false;
  try {
    // The getter throws for anything that is not an ArrayBuffer, whatever its prototype or tag.
    arrayBufferByteLength.call(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the body bytes, or `null` when `rawBody` is not a string, an
 * `ArrayBuffer` or an `ArrayBufferView`. Views (`Uint8Array`, Node `Buffer`,
 * `DataView`, other typed arrays) are read as the bytes they cover.
 */
export function bodyBytes(rawBody: unknown): Uint8Array | null {
  if (typeof rawBody === 'string') return utf8(rawBody);
  // `ArrayBuffer.isView` checks an internal slot, so it works across realms.
  if (ArrayBuffer.isView(rawBody)) return new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  if (isArrayBuffer(rawBody)) return new Uint8Array(rawBody);
  return null;
}

export function rawBodyProblem(rawBody: unknown): string {
  const kind = rawBody === null ? 'null' : Array.isArray(rawBody) ? 'array' : typeof rawBody;
  return `rawBody must be the exact request body as a string, Uint8Array, Buffer, ArrayBuffer or other ArrayBufferView, got ${kind}. Read the body before any JSON or form parser runs.`;
}

export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseJsonObject(bytes: Uint8Array): JsonObject | null {
  const text = decodeUtf8Strict(bytes);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isJsonObject(value) ? value : null;
  } catch {
    return null;
  }
}

export const looksLikeJson = (bytes: Uint8Array): boolean => /^\s*[{[]/.test(decodeUtf8(bytes.subarray(0, 64)));

export interface ParsedForm {
  /** Each name with its first value. */
  fields: Record<string, string>;
  /** Names that appeared more than once, with the same value or not. */
  repeated: Set<string>;
}

/** Parses `application/x-www-form-urlencoded` bytes. The first occurrence of a name is kept in `fields`. */
export function parseForm(bytes: Uint8Array): ParsedForm {
  const fields: Record<string, string> = {};
  const repeated = new Set<string>();
  new URLSearchParamsCtor(decodeUtf8(bytes)).forEach((value, key) => {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) fields[key] = value;
    else repeated.add(key);
  });
  return { fields, repeated };
}

// Small readers for loosely typed gateway payloads.

export const objectAt = (value: JsonValue | undefined): JsonObject | undefined =>
  isJsonObject(value) ? value : undefined;

export const arrayAt = (value: JsonValue | undefined): JsonValue[] | undefined =>
  Array.isArray(value) ? value : undefined;

/** A string, or a number written as a string (ids are sometimes sent as numbers). */
export function textAt(value: JsonValue | undefined): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function isoFromSeconds(value: JsonValue | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? isoFromMillis(value * 1000) : null;
}

export function isoFromMillis(value: JsonValue | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Parses an ISO 8601 date-time that carries a zone (`Z` or an offset). */
export function isoFromDateTime(value: JsonValue | undefined): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
