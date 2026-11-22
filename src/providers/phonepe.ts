// PhonePe Payment Gateway (Standard Checkout v2), "SHA" webhook authentication.
// Sources: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook
// and the official SDK (@phonepe-pg/pg-sdk-node, CommonUtils.isCallbackValid):
// Authorization = hex(SHA-256("username:password")). The body is not signed.

import { minorFromInteger } from '../core/amount.js';
import { arrayAt, bodyBytes, isoFromMillis, objectAt, parseJsonObject, rawBodyProblem, textAt } from '../core/body.js';
import { safeEqualText, toHex, utf8 } from '../core/bytes.js';
import { digest } from '../core/crypto.js';
import { readHeader } from '../core/headers.js';
import { guarded, isFailure, optionsObject, requireCredentials } from '../core/options.js';
import { fail, MalformedBody } from '../core/result.js';
import type {
  Credentials,
  CredentialsVerifyOptions,
  EventType,
  JsonObject,
  VerifyResult,
  WebhookEvent,
} from '../core/types.js';

export const PHONEPE_AUTHORIZATION_HEADER = 'authorization';

/** The value PhonePe puts in the `Authorization` header for these credentials. */
export async function phonepeAuthorization(credentials: Credentials): Promise<string> {
  return toHex(await digest('SHA-256', utf8(`${credentials.username}:${credentials.password}`)));
}

const EVENT_TYPES: Record<string, EventType> = {
  'checkout.order.completed': 'payment.captured',
  'checkout.order.failed': 'payment.failed',
  'pg.refund.completed': 'refund.processed',
  'pg.refund.failed': 'refund.failed',
};

function amountOf(payload: JsonObject): string {
  const amountMinor = minorFromInteger(payload.amount);
  if (amountMinor === null) throw new MalformedBody('payload.amount is not an integer amount in paisa.');
  return amountMinor;
}

export function normalizePhonepe(raw: JsonObject): WebhookEvent {
  // PhonePe: identify events by `event`, not `type`, and use `payload.state`.
  const providerType = textAt(raw.event);
  const type = (providerType !== null && EVENT_TYPES[providerType]) || 'unknown';
  const payload = objectAt(raw.payload);
  const details = (payload && arrayAt(payload.paymentDetails)) || [];
  const lastAttempt = objectAt(details[details.length - 1]);

  const event: WebhookEvent = {
    provider: 'phonepe',
    type,
    id: '',
    occurredAt: isoFromMillis(payload && payload.timestamp) || isoFromMillis(lastAttempt && lastAttempt.timestamp),
    providerType,
    raw,
  };

  if (type !== 'unknown' && !payload) throw new MalformedBody(`${providerType} has no payload.`);
  if (payload && type.startsWith('payment.')) {
    event.payment = {
      id: textAt(lastAttempt && lastAttempt.transactionId) || textAt(payload.orderId),
      orderId: textAt(payload.merchantOrderId) || textAt(payload.originalMerchantOrderId),
      amountMinor: amountOf(payload),
      // PhonePe sends no currency; its documented unit is paisa.
      currency: 'INR',
      status: textAt(payload.state),
      method: textAt(lastAttempt && lastAttempt.paymentMode),
    };
  } else if (payload && type.startsWith('refund.')) {
    event.refund = {
      id: textAt(payload.refundId),
      paymentId: null,
      orderId: textAt(payload.originalMerchantOrderId),
      amountMinor: amountOf(payload),
      currency: 'INR',
      status: textAt(payload.state),
    };
  }

  const entityId = payload && (textAt(payload.refundId) || textAt(payload.orderId));
  event.id = [providerType || 'event', entityId || '', textAt(payload && payload.state) || ''].join(':');
  return event;
}

/** Verifies a PhonePe webhook that uses username and password (SHA) authentication. Never throws. */
export function verifyPhonepeWebhook(options: CredentialsVerifyOptions): Promise<VerifyResult> {
  return guarded(async () => {
    const opts = optionsObject(options);
    if (isFailure(opts)) return opts;
    const credentials = requireCredentials(opts.credentials);
    if (isFailure(credentials)) return credentials;
    const body = bodyBytes(opts.rawBody);
    if (!body) return fail('invalid_options', rawBodyProblem(opts.rawBody));

    const authorization = readHeader(opts.headers, PHONEPE_AUTHORIZATION_HEADER);
    if (authorization === null) return fail('missing_header', 'The Authorization header is missing.');
    if (!safeEqualText(await phonepeAuthorization(credentials), authorization)) {
      return fail('bad_signature', 'The Authorization header does not match SHA-256 of the configured username and password.');
    }

    const raw = parseJsonObject(body);
    if (!raw) return fail('malformed_body', 'The body is not a JSON object.');
    return { ok: true, event: normalizePhonepe(raw) };
  });
}
