// Razorpay. Source: https://razorpay.com/docs/webhooks/validate-test/ and the
// official SDK's validateWebhookSignature (razorpay-node, razorpay-utils.js):
// X-Razorpay-Signature = hex(HMAC-SHA256(key = webhook secret, message = raw body)).

import { minorFromInteger } from '../core/amount.js';
import { bodyBytes, isoFromSeconds, objectAt, parseJsonObject, rawBodyProblem, textAt } from '../core/body.js';
import { safeEqualText, toHex, utf8 } from '../core/bytes.js';
import { hmacSha256 } from '../core/crypto.js';
import { readHeader } from '../core/headers.js';
import { guarded, isFailure, optionsObject, requireSecret } from '../core/options.js';
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

export const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';
export const RAZORPAY_EVENT_ID_HEADER = 'x-razorpay-event-id';

/** The value Razorpay puts in `X-Razorpay-Signature` for this body. */
export async function razorpaySignature(body: Uint8Array, secret: string): Promise<string> {
  return toHex(await hmacSha256(utf8(secret), body));
}

const EVENT_TYPES: Record<string, EventType> = {
  'payment.authorized': 'payment.authorized',
  'payment.captured': 'payment.captured',
  'payment.failed': 'payment.failed',
  'payment.pending': 'payment.pending',
  'refund.created': 'refund.created',
  'refund.processed': 'refund.processed',
  'refund.failed': 'refund.failed',
};

function paymentFrom(entity: JsonObject): PaymentDetails {
  const amountMinor = minorFromInteger(entity.amount);
  if (amountMinor === null) throw new MalformedBody('payload.payment.entity.amount is not an integer amount in paise.');
  return {
    id: textAt(entity.id),
    orderId: textAt(entity.order_id),
    amountMinor,
    currency: textAt(entity.currency),
    status: textAt(entity.status),
    method: textAt(entity.method),
  };
}

function refundFrom(entity: JsonObject, payment: PaymentDetails | undefined): RefundDetails {
  const amountMinor = minorFromInteger(entity.amount);
  if (amountMinor === null) throw new MalformedBody('payload.refund.entity.amount is not an integer amount in paise.');
  return {
    id: textAt(entity.id),
    paymentId: textAt(entity.payment_id),
    orderId: payment ? payment.orderId : null,
    amountMinor,
    currency: textAt(entity.currency),
    status: textAt(entity.status),
  };
}

export function normalizeRazorpay(raw: JsonObject, eventId: string | null): WebhookEvent {
  const providerType = textAt(raw.event);
  const type = (providerType !== null && EVENT_TYPES[providerType]) || 'unknown';
  const payload = objectAt(raw.payload);
  const paymentEntity = payload && objectAt(objectAt(payload.payment)?.entity);
  const refundEntity = payload && objectAt(objectAt(payload.refund)?.entity);

  const event: WebhookEvent = {
    provider: 'razorpay',
    type,
    id: '',
    occurredAt: isoFromSeconds(raw.created_at),
    providerType,
    raw,
  };

  if (type.startsWith('payment.')) {
    if (!paymentEntity) throw new MalformedBody(`${providerType} has no payload.payment.entity.`);
    event.payment = paymentFrom(paymentEntity);
  } else if (type.startsWith('refund.')) {
    if (!refundEntity) throw new MalformedBody(`${providerType} has no payload.refund.entity.`);
    if (paymentEntity) event.payment = paymentFrom(paymentEntity);
    event.refund = refundFrom(refundEntity, event.payment);
  }

  const entityId = textAt((refundEntity || paymentEntity || {}).id);
  event.id = eventId || [providerType || 'event', entityId || '', textAt(raw.created_at) || ''].join(':');
  return event;
}

/** Verifies a Razorpay webhook and normalises it. Never throws. */
export function verifyRazorpayWebhook(options: SecretVerifyOptions): Promise<VerifyResult> {
  return guarded(async () => {
    const opts = optionsObject(options);
    if (isFailure(opts)) return opts;
    const secret = requireSecret(opts.secret, 'secret (the Razorpay webhook secret)');
    if (isFailure(secret)) return secret;
    const body = bodyBytes(opts.rawBody);
    if (!body) return fail('invalid_options', rawBodyProblem(opts.rawBody));

    const signature = readHeader(opts.headers, RAZORPAY_SIGNATURE_HEADER);
    if (signature === null) return fail('missing_header', 'The X-Razorpay-Signature header is missing.');
    if (!safeEqualText(await razorpaySignature(body, secret), signature)) {
      return fail('bad_signature', 'X-Razorpay-Signature does not match the body and secret.');
    }

    const raw = parseJsonObject(body);
    if (!raw) return fail('malformed_body', 'The body is not a JSON object.');
    return { ok: true, event: normalizeRazorpay(raw, readHeader(opts.headers, RAZORPAY_EVENT_ID_HEADER)) };
  });
}
