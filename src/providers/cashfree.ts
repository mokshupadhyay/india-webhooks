// Cashfree Payments (Payment Gateway). Sources:
// https://www.cashfree.com/docs/payments/online/webhooks/signature-verification
// https://www.cashfree.com/docs/api-reference/webhooks/reliability-and-operations
// and the official SDK's PGVerifyWebhookSignature (cashfree-pg):
// x-webhook-signature = base64(HMAC-SHA256(key = client secret,
//                              message = x-webhook-timestamp + raw body)).
// The timestamp is in milliseconds; Cashfree recommends rejecting anything
// older than five minutes.

import { minorFromDecimal } from '../core/amount.js';
import { bodyBytes, isoFromDateTime, objectAt, parseJsonObject, rawBodyProblem, textAt } from '../core/body.js';
import { concatBytes, safeEqualText, toBase64, utf8 } from '../core/bytes.js';
import { hmacSha256 } from '../core/crypto.js';
import { readHeader } from '../core/headers.js';
import { guarded, isFailure, optionsObject, requireSecret, resolveNow, resolveTolerance } from '../core/options.js';
import { fail, MalformedBody } from '../core/result.js';
import type {
  EventType,
  JsonObject,
  PaymentDetails,
  RefundDetails,
  SecretVerifyOptions,
  VerifyResult,
  WebhookEvent,
} from '../core/types.js';

export const CASHFREE_SIGNATURE_HEADER = 'x-webhook-signature';
export const CASHFREE_TIMESTAMP_HEADER = 'x-webhook-timestamp';
export const CASHFREE_IDEMPOTENCY_HEADER = 'x-idempotency-key';
export const CASHFREE_DEFAULT_TOLERANCE_SECONDS = 300;

/** The value Cashfree puts in `x-webhook-signature` for this timestamp header value and body. */
export async function cashfreeSignature(timestamp: string, body: Uint8Array, secret: string): Promise<string> {
  return toBase64(await hmacSha256(utf8(secret), concatBytes(utf8(timestamp), body)));
}

const PAYMENT_TYPES: Record<string, EventType> = {
  PAYMENT_SUCCESS_WEBHOOK: 'payment.captured',
  PAYMENT_FAILED_WEBHOOK: 'payment.failed',
  PAYMENT_USER_DROPPED_WEBHOOK: 'payment.failed',
};

const REFUND_TYPES: Record<string, string> = {
  REFUND_STATUS_WEBHOOK: 'refund',
  AUTO_REFUND_STATUS_WEBHOOK: 'auto_refund',
};

function paymentFrom(data: JsonObject): PaymentDetails {
  const payment = objectAt(data.payment);
  if (!payment) throw new MalformedBody('data.payment is missing.');
  const amountMinor = minorFromDecimal(payment.payment_amount);
  if (amountMinor === null) throw new MalformedBody('data.payment.payment_amount is not an amount in rupees.');
  return {
    id: textAt(payment.cf_payment_id),
    orderId: textAt(objectAt(data.order)?.order_id),
    amountMinor,
    currency: textAt(payment.payment_currency),
    status: textAt(payment.payment_status),
    method: textAt(payment.payment_group),
  };
}

function refundFrom(refund: JsonObject, key: string): RefundDetails {
  const amountMinor = minorFromDecimal(refund.refund_amount);
  if (amountMinor === null) throw new MalformedBody(`data.${key}.refund_amount is not an amount in rupees.`);
  return {
    id: textAt(refund.cf_refund_id),
    paymentId: textAt(refund.cf_payment_id),
    orderId: textAt(refund.order_id),
    amountMinor,
    currency: textAt(refund.refund_currency),
    status: textAt(refund.refund_status),
  };
}

/** `deliveryId` is the unsigned `x-idempotency-key` header, or `null`. */
export function normalizeCashfree(raw: JsonObject, deliveryId: string | null): WebhookEvent {
  const providerType = textAt(raw.type);
  const data = objectAt(raw.data) || {};
  const event: WebhookEvent = {
    provider: 'cashfree',
    type: 'unknown',
    id: '',
    deliveryId,
    occurredAt: isoFromDateTime(raw.event_time),
    providerType,
    raw,
  };

  let entityId: string | null = null;
  if (providerType !== null && PAYMENT_TYPES[providerType]) {
    event.type = PAYMENT_TYPES[providerType];
    event.payment = paymentFrom(data);
    entityId = event.payment.id;
  } else if (providerType !== null && REFUND_TYPES[providerType]) {
    const key = REFUND_TYPES[providerType];
    const refund = objectAt(data[key]);
    // Only SUCCESS appears in Cashfree's samples; other statuses stay unknown.
    if (refund && textAt(refund.refund_status) === 'SUCCESS') {
      event.type = 'refund.processed';
      event.refund = refundFrom(refund, key);
    }
    entityId = refund ? textAt(refund.cf_refund_id) : null;
  } else {
    entityId = textAt(objectAt(data.payment)?.cf_payment_id) || textAt(objectAt(data.refund)?.cf_refund_id);
  }

  // Only signed body fields: the event type, the entity id and the event time.
  event.id = [providerType || 'event', entityId || '', textAt(raw.event_time) || ''].join(':');
  return event;
}

/** Verifies a Cashfree Payment Gateway webhook and normalises it. Never throws. */
export function verifyCashfreeWebhook(options: SecretVerifyOptions): Promise<VerifyResult> {
  return guarded(async () => {
    const opts = optionsObject(options);
    if (isFailure(opts)) return opts;
    const secret = requireSecret(opts.secret, 'secret (the Cashfree client secret)');
    if (isFailure(secret)) return secret;
    const body = bodyBytes(opts.rawBody);
    if (!body) return fail('invalid_options', rawBodyProblem(opts.rawBody));
    const now = resolveNow(opts.now);
    if (isFailure(now)) return now;
    const tolerance = resolveTolerance(opts.toleranceSeconds, CASHFREE_DEFAULT_TOLERANCE_SECONDS);
    if (isFailure(tolerance)) return tolerance;

    const signature = readHeader(opts.headers, CASHFREE_SIGNATURE_HEADER);
    if (signature === null) return fail('missing_header', 'The x-webhook-signature header is missing.');
    const timestamp = readHeader(opts.headers, CASHFREE_TIMESTAMP_HEADER);
    if (timestamp === null) return fail('missing_header', 'The x-webhook-timestamp header is missing.');

    if (!safeEqualText(await cashfreeSignature(timestamp, body, secret), signature)) {
      return fail('bad_signature', 'x-webhook-signature does not match the timestamp, body and secret.');
    }
    if (!/^\d{1,16}$/.test(timestamp)) {
      return fail('stale_timestamp', 'x-webhook-timestamp is not a timestamp in milliseconds.');
    }
    const skewMs = Math.abs(now - Number(timestamp));
    if (skewMs > tolerance * 1000) {
      return fail('stale_timestamp', `x-webhook-timestamp is ${Math.round(skewMs / 1000)}s from now; the limit is ${tolerance}s.`);
    }

    const raw = parseJsonObject(body);
    if (!raw) return fail('malformed_body', 'The body is not a JSON object.');
    return { ok: true, event: normalizeCashfree(raw, readHeader(opts.headers, CASHFREE_IDEMPOTENCY_HEADER)) };
  });
}
