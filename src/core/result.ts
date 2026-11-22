import type { FailureReason, VerifyFailure } from './types.js';

export const fail = (reason: FailureReason, message: string): VerifyFailure => ({ ok: false, reason, message });

/** Thrown inside normalisers and turned into a `malformed_body` result. */
export class MalformedBody extends Error {}
