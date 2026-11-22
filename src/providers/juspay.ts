// Juspay (Express Checkout / HyperCheckout). Source:
// https://juspay.io/in/docs/api-reference/docs/express-checkout/webhooks
// Juspay sends `Authorization: Basic base64(username:password)` with the
// credentials configured in its dashboard. Nothing is signed: the header
// proves who sent the request, but the body is not authenticated.

import { minorFromDecimal } from '../core/amount.js';
import { arrayAt, bodyBytes, isoFromDateTime, objectAt, parseJsonObject, rawBodyProblem, textAt } from '../core/body.js';
import { fromBase64, timingSafeEqual, toBase64, utf8 } from '../core/bytes.js';
import { digest } from '../core/crypto.js';
import { readHeader } from '../core/headers.js';
import { guarded, isFailure, optionsObject, requireCredentials } from '../core/options.js';
import { fail, MalformedBody } from '../core/result.js';
import type {
  Credentials,
  CredentialsVerifyOptions,
  EventType,
  JsonObject,
  PaymentDetails,
  RefundDetails,
  VerifyResult,
  WebhookEvent,
} from '../core/types.js';

export const JUSPAY_AUTHORIZATION_HEADER = 'authorization';

/** The `Authorization` header Juspay sends for these credentials. */
export const juspayAuthorization = (credentials: Credentials): string =>
  `Basic ${toBase64(utf8(`${credentials.username}:${credentials.password}`))}`;

const PAYMENT_TYPES: Record<string, EventType> = {
  ORDER_SUCCEEDED: 'payment.captured',
  ORDER_FAILED: 'payment.failed',
  ORDER_AUTHORIZED: 'payment.authorized',
};

const REFUND_TYPES: Record<string, EventType> = {
  ORDER_REFUNDED: 'refund.processed',
  ORDER_REFUND_FAILED: 'refund.failed',
  REFUND_INITIATED: 'refund.created',
};

function paymentFrom(order: JsonObject): PaymentDetails {
  const amountMinor = minorFromDecimal(order.amount);
  if (amountMinor === null) throw new MalformedBody('content.order.amount is not an amount in rupees.');
  const txn = objectAt(order.txn_detail);
  return {
    id: textAt(txn && txn.txn_uuid) || textAt(order.txn_uuid) || textAt(order.txn_id),
    orderId: textAt(order.order_id),
    amountMinor,
    currency: textAt(order.currency),
    status: textAt(order.status),
    method: textAt(order.payment_method_type),
  };
}

/** The most recently created entry of `order.refunds`. */
function latestRefund(order: JsonObject): JsonObject | undefined {
  let latest: JsonObject | undefined;
  for (const item of arrayAt(order.refunds) || []) {
    const refund = objectAt(item);
    if (refund && (!latest || (textAt(refund.created) || '') >= (textAt(latest.created) || ''))) latest = refund;
  }
  return latest;
}

function refundFrom(refund: JsonObject, payment: PaymentDetails, order: JsonObject): RefundDetails {
  const amountMinor = minorFromDecimal(refund.amount);
  if (amountMinor === null) throw new MalformedBody('content.order.refunds[].amount is not an amount in rupees.');
  return {
    id: textAt(refund.unique_request_id) || textAt(refund.id),
    paymentId: payment.id,
    orderId: payment.orderId,
    amountMinor,
    currency: textAt(order.currency),
    status: textAt(refund.status),
  };
}

export function normalizeJuspay(raw: JsonObject): WebhookEvent {
  const providerType = textAt(raw.event_name);
  const order = objectAt(objectAt(raw.content)?.order);
  const event: WebhookEvent = {
    provider: 'juspay',
    type: 'unknown',
    id: '',
    occurredAt: isoFromDateTime(raw.date_created),
    providerType,
    raw,
  };

  if (providerType !== null && (PAYMENT_TYPES[providerType] || REFUND_TYPES[providerType])) {
    if (!order) throw new MalformedBody(`${providerType} has no content.order.`);
    event.type = PAYMENT_TYPES[providerType] || REFUND_TYPES[providerType];
    event.payment = paymentFrom(order);
    if (REFUND_TYPES[providerType]) {
      const refund = latestRefund(order);
      if (refund) event.refund = refundFrom(refund, event.payment, order);
    }
  }

  event.id = textAt(raw.id) || [providerType || 'event', textAt(order && order.id) || ''].join(':');
  return event;
}

/** Verifies a Juspay webhook's Basic authentication header and normalises the body. Never throws. */
export function verifyJuspayWebhook(options: CredentialsVerifyOptions): Promise<VerifyResult> {
  return guarded(async () => {
    const opts = optionsObject(options);
    if (isFailure(opts)) return opts;
    const credentials = requireCredentials(opts.credentials);
    if (isFailure(credentials)) return credentials;
    const body = bodyBytes(opts.rawBody);
    if (!body) return fail('invalid_options', rawBodyProblem(opts.rawBody));

    const authorization = readHeader(opts.headers, JUSPAY_AUTHORIZATION_HEADER);
    if (authorization === null) return fail('missing_header', 'The Authorization header is missing.');
    const match = /^\s*basic\s+(\S+)\s*$/i.exec(authorization);
    const presented = match ? fromBase64(match[1]) : null;
    const expected = utf8(`${credentials.username}:${credentials.password}`);
    // Compare digests so the time taken does not depend on the length of the password.
    const matches =
      presented !== null &&
      timingSafeEqual(await digest('SHA-256', expected), await digest('SHA-256', presented));
    if (!matches) {
      return fail('bad_signature', 'The Basic Authorization header does not match the configured username and password.');
    }

    const raw = parseJsonObject(body);
    if (!raw) return fail('malformed_body', 'The body is not a JSON object.');
    if (typeof raw.JWT === 'string' && raw.event_name === undefined) {
      return fail('unsupported_event', 'JWT-encrypted Juspay webhooks are not supported.');
    }
    return { ok: true, event: normalizeJuspay(raw) };
  });
}
