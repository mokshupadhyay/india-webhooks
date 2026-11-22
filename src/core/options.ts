import { fail, MalformedBody } from './result.js';
import type { Credentials, VerifyFailure, VerifyResult } from './types.js';

/** A message for anything thrown, including values that cannot be turned into strings. */
export function describeError(error: unknown): string {
  try {
    return error instanceof Error ? String(error.message) : String(error);
  } catch {
    return 'An exception was thrown whose value cannot be turned into a string.';
  }
}

/** Runs a verifier and turns anything it throws into a failure result. */
export async function guarded(run: () => Promise<VerifyResult>): Promise<VerifyResult> {
  try {
    return await run();
  } catch (error) {
    let isMalformed = false;
    try {
      isMalformed = error instanceof MalformedBody;
    } catch {
      // `instanceof` can throw for a proxy; such a value did not come from this package.
    }
    return isMalformed ? fail('malformed_body', describeError(error)) : fail('internal_error', describeError(error));
  }
}

export const isFailure = (value: unknown): value is VerifyFailure =>
  typeof value === 'object' && value !== null && (value as VerifyFailure).ok === false;

export function optionsObject<T>(options: T): T | VerifyFailure {
  return typeof options === 'object' && options !== null
    ? options
    : fail('invalid_options', 'Options must be an object.');
}

/** True for a string that is empty or only whitespace. */
export const isBlank = (value: string): boolean => value.trim() === '';

export function requireSecret(secret: unknown, label: string): string | VerifyFailure {
  return typeof secret === 'string' && !isBlank(secret)
    ? secret
    : fail('invalid_options', `${label} must be a non-empty string that is not only whitespace.`);
}

/**
 * Both values must be non-blank strings. With an empty username and password
 * anyone can compute the expected header (for example `Basic Og==`), so empty
 * credentials are a configuration error, not something to verify against.
 */
export function requireCredentials(credentials: unknown): Credentials | VerifyFailure {
  if (typeof credentials !== 'object' || credentials === null) {
    return fail('invalid_options', 'credentials must be { username: string, password: string }.');
  }
  const { username, password } = credentials as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string') {
    return fail('invalid_options', 'credentials must be { username: string, password: string }.');
  }
  if (isBlank(username) || isBlank(password)) {
    return fail('invalid_options', 'credentials.username and credentials.password must be non-empty and not only whitespace.');
  }
  return { username, password };
}

/** Current time in milliseconds. */
export function resolveNow(now: unknown): number | VerifyFailure {
  if (now === undefined) return Date.now();
  const ms = now instanceof Date || Object.prototype.toString.call(now) === '[object Date]'
    ? (now as Date).getTime()
    : now;
  return typeof ms === 'number' && Number.isFinite(ms)
    ? ms
    : fail('invalid_options', 'now must be a valid Date or a number of milliseconds.');
}

export function resolveTolerance(tolerance: unknown, fallback: number): number | VerifyFailure {
  if (tolerance === undefined) return fallback;
  return typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance >= 0
    ? tolerance
    : fail('invalid_options', 'toleranceSeconds must be a finite number of seconds, 0 or more.');
}
