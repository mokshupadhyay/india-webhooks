import { fail, MalformedBody } from './result.js';
import type { Credentials, VerifyFailure, VerifyResult } from './types.js';

/** Runs a verifier and turns anything it throws into a failure result. */
export async function guarded(run: () => Promise<VerifyResult>): Promise<VerifyResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MalformedBody) return fail('malformed_body', error.message);
    const message = error instanceof Error ? error.message : String(error);
    return fail('internal_error', message);
  }
}

export const isFailure = (value: unknown): value is VerifyFailure =>
  typeof value === 'object' && value !== null && (value as VerifyFailure).ok === false;

export function optionsObject<T>(options: T): T | VerifyFailure {
  return typeof options === 'object' && options !== null
    ? options
    : fail('invalid_options', 'Options must be an object.');
}

export function requireSecret(secret: unknown, label: string): string | VerifyFailure {
  return typeof secret === 'string' && secret !== ''
    ? secret
    : fail('invalid_options', `${label} must be a non-empty string.`);
}

export function requireCredentials(credentials: unknown): Credentials | VerifyFailure {
  const c = credentials as Credentials | undefined;
  if (typeof c === 'object' && c !== null && typeof c.username === 'string' && typeof c.password === 'string') {
    return { username: c.username, password: c.password };
  }
  return fail('invalid_options', 'credentials must be { username: string, password: string }.');
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
