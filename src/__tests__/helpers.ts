import type { VerifyResult } from '../core/types';

/** Changes the character at `index` to a different printable ASCII character. */
export function changeChar(text: string, index: number): string {
  const c = text.charAt(index);
  const replacement = c === 'x' ? 'y' : c === '0' ? '1' : /[0-9]/.test(c) ? '0' : 'x';
  return text.slice(0, index) + replacement + text.slice(index + 1);
}

/** Every index of a string, for exhaustive one-character tamper tests. */
export const indexes = (text: string): number[] => Array.from({ length: text.length }, (_, i) => i);

export function expectOk(result: VerifyResult) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.message}`);
  return result.event;
}

export function expectReason(result: VerifyResult, reason: string) {
  expect(result.ok ? 'ok' : result.reason).toBe(reason);
}
