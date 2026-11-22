// Easebuzz payment webhooks. The public docs site could not be read, so the
// scheme comes from Easebuzz's own integration code: the webhook handler in
// paywitheasebuzz-wordpress-woocommerce-lib (update_webhook.php and
// easebuzz_compute_reverse_hash in easepay-lib.php) and _getReverseHashKey in
// paywitheasebuzz-nodejs-lib. Both compute
// hash = hex(SHA-512("salt|status|udf10|...|udf1|email|firstname|productinfo|amount|txnid|key")).

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
    // As easebuzz_apply_payment_status in the WooCommerce plugin's easepay-lib.php:
    // the status is lowercased, `success` and `pending` are kept, and every other
    // status (`usercancelled` and the default branch) marks the order failed.
    switch (field(fields, 'status').toLowerCase()) {
      case 'success':
        return 'payment.captured';
      case 'pending':
        return 'payment.pending';
      default:
        return 'payment.failed';
    }
  },
  paymentId(fields) {
    const id = field(fields, 'easepayid').trim();
    return id === '' ? null : id;
  },
  jsonBodyNote: 'Easebuzz webhooks are form-encoded.',
};

/** The value Easebuzz puts in the `hash` field for these form fields. */
export const easebuzzHash = (fields: FormFields, salt: string): Promise<string> => formHash(easebuzzScheme, fields, salt);

export const normalizeEasebuzz = (fields: Record<string, string>): WebhookEvent => normalizeForm(easebuzzScheme, fields);

/** Verifies an Easebuzz payment webhook (form-encoded, reverse hash) and normalises it. Never throws. */
export const verifyEasebuzzWebhook = (options: SecretVerifyOptions): Promise<VerifyResult> =>
  verifyForm(easebuzzScheme, options);
