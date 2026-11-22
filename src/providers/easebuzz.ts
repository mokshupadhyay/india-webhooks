// Easebuzz payment webhooks. The public docs site could not be read, so the
// scheme comes from Easebuzz's own integration code: the webhook handler in
// paywitheasebuzz-wordpress-woocommerce-lib (update_webhook.php and
// easebuzz_compute_reverse_hash in easepay-lib.php) and _getReverseHashKey in
// paywitheasebuzz-nodejs-lib. Both compute
// hash = hex(SHA-512("salt|status|udf10|...|udf1|email|firstname|productinfo|amount|txnid|key")).

import { fail } from '../core/result.js';
import type { SecretVerifyOptions, VerifyResult, WebhookEvent } from '../core/types.js';
import { field, formHash, normalizeForm, verifyForm } from './form.js';
import type { FormFields, FormScheme } from './form.js';

const SEQUENCE = [
  'udf10',
  'udf9',
  'udf8',
  'udf7',
  'udf6',
  'udf5',
  'udf4',
  'udf3',
  'udf2',
  'udf1',
  'email',
  'firstname',
  'productinfo',
  'amount',
  'txnid',
  'key',
];

export const easebuzzScheme: FormScheme = {
  provider: 'easebuzz',
  label: 'Easebuzz',
  hashedFields: ['status', ...SEQUENCE],
  hashString: (fields, salt) => [salt, field(fields, 'status'), ...SEQUENCE.map((name) => field(fields, name))].join('|'),
  eventType(fields) {
    // The statuses Easebuzz's own handler distinguishes. Anything else stays unknown.
    switch (field(fields, 'status')) {
      case 'success':
        return 'payment.captured';
      case 'pending':
        return 'payment.pending';
      case 'usercancelled':
        return 'payment.failed';
      default:
        return 'unknown';
    }
  },
  paymentId(fields) {
    const id = field(fields, 'easepayid').trim();
    return id === '' ? null : id;
  },
  jsonBody: () => fail('malformed_body', 'Easebuzz webhooks are form-encoded; this body is JSON.'),
};

/** The value Easebuzz puts in the `hash` field for these form fields. */
export const easebuzzHash = (fields: FormFields, salt: string): Promise<string> => formHash(easebuzzScheme, fields, salt);

export const normalizeEasebuzz = (fields: Record<string, string>): WebhookEvent => normalizeForm(easebuzzScheme, fields);

/** Verifies an Easebuzz payment webhook (form-encoded, reverse hash) and normalises it. Never throws. */
export const verifyEasebuzzWebhook = (options: SecretVerifyOptions): Promise<VerifyResult> =>
  verifyForm(easebuzzScheme, options);
