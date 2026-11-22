// PayU India payment webhooks. Sources:
// https://docs.payu.in/docs/webhook-events-and-sample-payloads
// https://docs.payu.in/docs/hashing-request-and-response (reverse hashing)
// and the official SDK's validateHash (payu-india/payu-sdk-node, hasher.js):
// hash = hex(SHA-512("[additionalCharges|]SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key")).

import { fail } from '../core/result.js';
import type { SecretVerifyOptions, VerifyResult, WebhookEvent } from '../core/types.js';
import { field, formHash, normalizeForm, verifyForm } from './form.js';
import type { FormFields, FormScheme } from './form.js';

export const payuScheme: FormScheme = {
  provider: 'payu',
  label: 'PayU',
  hashedFields: ['additionalCharges', 'status', 'udf5', 'udf4', 'udf3', 'udf2', 'udf1', 'email', 'firstname', 'productinfo', 'amount', 'txnid', 'key'],
  hashString(fields, salt) {
    const additionalCharges = field(fields, 'additionalCharges');
    const parts = [
      salt,
      field(fields, 'status'),
      // Five reserved positions that are always empty in the response hash.
      '',
      '',
      '',
      '',
      '',
      field(fields, 'udf5'),
      field(fields, 'udf4'),
      field(fields, 'udf3'),
      field(fields, 'udf2'),
      field(fields, 'udf1'),
      field(fields, 'email'),
      field(fields, 'firstname'),
      field(fields, 'productinfo'),
      field(fields, 'amount'),
      field(fields, 'txnid'),
      field(fields, 'key'),
    ];
    return (additionalCharges === '' ? '' : `${additionalCharges}|`) + parts.join('|');
  },
  eventType(fields) {
    switch (field(fields, 'status')) {
      case 'success':
        // `unmappedstatus` is not covered by the hash; see the README.
        return field(fields, 'unmappedstatus') === 'auth' ? 'payment.authorized' : 'payment.captured';
      case 'failure':
        return 'payment.failed';
      case 'pending':
        return 'payment.pending';
      default:
        return 'unknown';
    }
  },
  paymentId(fields) {
    const id = field(fields, 'mihpayid').trim();
    return id === '' ? null : id;
  },
  jsonBody: () =>
    fail(
      'unsupported_event',
      'PayU refund and dispute webhooks are JSON and carry no hash or signature, so they cannot be verified.',
    ),
};

/** The value PayU puts in the `hash` field for these form fields. */
export const payuHash = (fields: FormFields, salt: string): Promise<string> => formHash(payuScheme, fields, salt);

export const normalizePayu = (fields: Record<string, string>): WebhookEvent => normalizeForm(payuScheme, fields);

/** Verifies a PayU payment webhook (form-encoded, reverse hash) and normalises it. Never throws. */
export const verifyPayuWebhook = (options: SecretVerifyOptions): Promise<VerifyResult> => verifyForm(payuScheme, options);
