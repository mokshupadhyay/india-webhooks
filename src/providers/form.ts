// Shared handling for gateways that post `application/x-www-form-urlencoded`
// payment results with a SHA-512 "reverse hash" field (PayU, Easebuzz).

import { minorFromDecimal } from '../core/amount.js';
import { bodyBytes, looksLikeJson, parseForm, rawBodyProblem } from '../core/body.js';
import { safeEqualText, toHex, utf8 } from '../core/bytes.js';
import { digest } from '../core/crypto.js';
import { guarded, isFailure, optionsObject, requireSecret } from '../core/options.js';
import { fail, MalformedBody } from '../core/result.js';
import type { EventType, Provider, SecretVerifyOptions, VerifyResult, WebhookEvent } from '../core/types.js';

export type FormFields = Readonly<Record<string, string>>;

export interface FormScheme {
  provider: Provider;
  label: string;
  /** Field names that feed the hash. Every other field goes into `event.unverified`. */
  hashedFields: readonly string[];
  hashString(fields: FormFields, salt: string): string;
  /** Must read only fields in `hashedFields`. */
  eventType(fields: FormFields): EventType;
  paymentId(fields: FormFields): string | null;
  /** Explains, in the `missing_header` message, why a JSON body cannot be verified. */
  jsonBodyNote: string;
}

export const field = (fields: FormFields, name: string): string =>
  Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : '';

export async function formHash(scheme: FormScheme, fields: FormFields, salt: string): Promise<string> {
  return toHex(await digest('SHA-512', utf8(scheme.hashString(fields, salt))));
}

/** The fields the hash does not cover, so anyone could have changed them. */
function unverifiedFields(scheme: FormScheme, fields: FormFields): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(fields)) {
    if (name !== 'hash' && scheme.hashedFields.indexOf(name) < 0) out[name] = fields[name];
  }
  return out;
}

export function normalizeForm(scheme: FormScheme, fields: Record<string, string>): WebhookEvent {
  const type = scheme.eventType(fields);
  const status = fields.status === undefined ? null : fields.status;
  const txnid = field(fields, 'txnid');
  const event: WebhookEvent = {
    provider: scheme.provider,
    type,
    // Built only from hashed fields, so it cannot be changed without breaking the hash.
    id: `${txnid}:${field(fields, 'status')}`,
    // Neither gateway sends a delivery id.
    deliveryId: null,
    // The payloads carry `addedon` without a time zone, so it is left in `raw`.
    occurredAt: null,
    providerType: status,
    unverified: unverifiedFields(scheme, fields),
    raw: fields,
  };
  if (type !== 'unknown') {
    const amountMinor = minorFromDecimal(field(fields, 'amount'));
    if (amountMinor === null) throw new MalformedBody('The amount field is not an amount in rupees.');
    event.payment = {
      // `mihpayid` / `easepayid` and `mode` are not hashed; see `unverified`.
      id: scheme.paymentId(fields),
      orderId: txnid === '' ? null : txnid,
      amountMinor,
      // Neither gateway sends a currency field.
      currency: null,
      status,
      method: fields.mode === undefined || fields.mode === '' ? null : fields.mode,
    };
  }
  return event;
}

export function verifyForm(scheme: FormScheme, options: SecretVerifyOptions): Promise<VerifyResult> {
  return guarded(async () => {
    const opts = optionsObject(options);
    if (isFailure(opts)) return opts;
    const salt = requireSecret(opts.secret, `secret (the ${scheme.label} merchant salt)`);
    if (isFailure(salt)) return salt;
    const body = bodyBytes(opts.rawBody);
    if (!body) return fail('invalid_options', rawBodyProblem(opts.rawBody));

    // Authenticate first: until the hash matches, every failure is an authentication failure.
    const { fields, repeated } = parseForm(body);
    const received = field(fields, 'hash');
    if (received === '') {
      return fail(
        'missing_header',
        looksLikeJson(body)
          ? `The body is JSON and has no hash field. ${scheme.jsonBodyNote}`
          : 'The form field `hash` is missing.',
      );
    }
    if (!safeEqualText(await formHash(scheme, fields, salt), received)) {
      return fail('bad_signature', `The hash field does not match the ${scheme.label} reverse hash of the fields and salt.`);
    }
    // The hash matched the first value of each field. A repeated field means
    // the body is not what the gateway sent, and the copies could be read
    // differently by other parsers, so the body is rejected.
    if (repeated.size > 0) {
      return fail('malformed_body', `Fields appear more than once: ${Array.from(repeated).join(', ')}.`);
    }
    return { ok: true, event: normalizeForm(scheme, fields) };
  });
}
