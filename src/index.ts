import { fail } from './core/result.js';
import type { CredentialsVerifyOptions, Provider, SecretVerifyOptions, VerifyOptionsMap, VerifyResult } from './core/types.js';
import { verifyCashfreeWebhook } from './providers/cashfree.js';
import { verifyEasebuzzWebhook } from './providers/easebuzz.js';
import { verifyJuspayWebhook } from './providers/juspay.js';
import { verifyPayuWebhook } from './providers/payu.js';
import { verifyPhonepeWebhook } from './providers/phonepe.js';
import { verifyRazorpayWebhook } from './providers/razorpay.js';

/**
 * Verifies a webhook from any supported gateway and returns a normalised event.
 * Never throws and never rejects: every problem is reported as `{ ok: false, reason }`.
 *
 * Importing this entry point bundles every gateway. Import a subpath such as
 * `india-webhooks/razorpay` to ship only one.
 */
export function verifyWebhook<P extends Provider>(provider: P, options: VerifyOptionsMap[P]): Promise<VerifyResult> {
  // Nothing here can throw: `switch` compares with `===`, which runs no user
  // code, and each verifier returns a promise that never rejects.
  switch (provider as unknown) {
    case 'razorpay':
      return verifyRazorpayWebhook(options as SecretVerifyOptions);
    case 'cashfree':
      return verifyCashfreeWebhook(options as SecretVerifyOptions);
    case 'phonepe':
      return verifyPhonepeWebhook(options as CredentialsVerifyOptions);
    case 'payu':
      return verifyPayuWebhook(options as SecretVerifyOptions);
    case 'juspay':
      return verifyJuspayWebhook(options as CredentialsVerifyOptions);
    case 'easebuzz':
      return verifyEasebuzzWebhook(options as SecretVerifyOptions);
    default:
      return Promise.resolve(fail('invalid_options', `Unknown provider: ${describeProvider(provider)}.`));
  }
}

/** Names the bad provider without calling any of its methods, so it cannot throw. */
function describeProvider(provider: unknown): string {
  if (typeof provider === 'string') return JSON.stringify(provider.length > 40 ? `${provider.slice(0, 40)}...` : provider);
  return provider === null ? 'null' : `a value of type ${typeof provider}`;
}

export { PROVIDERS } from './core/types.js';
export { verifyCashfreeWebhook } from './providers/cashfree.js';
export { verifyEasebuzzWebhook } from './providers/easebuzz.js';
export { verifyJuspayWebhook } from './providers/juspay.js';
export { verifyPayuWebhook } from './providers/payu.js';
export { verifyPhonepeWebhook } from './providers/phonepe.js';
export { verifyRazorpayWebhook } from './providers/razorpay.js';
export type {
  BaseVerifyOptions,
  Credentials,
  CredentialsVerifyOptions,
  EventType,
  FailureReason,
  HeaderEntries,
  HeaderForEach,
  HeadersInput,
  HeadersLike,
  HeaderValue,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  PaymentDetails,
  Provider,
  RawBody,
  RefundDetails,
  SecretVerifyOptions,
  VerifyFailure,
  VerifyOptionsMap,
  VerifyResult,
  VerifySuccess,
  WebhookEvent,
} from './core/types.js';
