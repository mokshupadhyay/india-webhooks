# india-webhooks

[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/mokshupadhyay/india-webhooks/blob/main/LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-mokshupadhyay%2Findia--webhooks-181717?logo=github)](https://github.com/mokshupadhyay/india-webhooks)

Verify and normalise payment webhooks from Indian payment gateways, and test your handler with requests signed the same way the gateways sign them.

Every gateway authenticates webhooks differently: an HMAC of the body, an HMAC of a timestamp plus the body, a SHA-512 of form fields in reverse order, or only a hash of a username and password. This package checks each one exactly as the gateway documents it and returns one event shape with amounts as integer paise.

- **Six gateways.** Razorpay, Cashfree Payments, PhonePe Payment Gateway, PayU India, Juspay and Easebuzz. Every rule is taken from the gateway's docs or official SDK, listed in [docs/SOURCES.md](docs/SOURCES.md).
- **Never throws.** `verifyWebhook` returns `{ ok: true, event }` or `{ ok: false, reason }` with a fixed set of reasons. Comparisons are constant-time.
- **Integer amounts.** `amountMinor` is always a string of integer paise, converted from each gateway's documented unit without float arithmetic.
- **Test kit.** `india-webhooks/testing` signs payloads and generates duplicated, out-of-order, late, tampered and stale deliveries.
- **Small.** Zero runtime dependencies. Hashing uses Web Crypto (`crypto.subtle`). Each gateway has its own subpath, such as `india-webhooks/razorpay`, so you ship only what you use.

## Install

```sh
npm install india-webhooks
```

Version 0.1.0 is new. It has been tested against the gateways' published test vectors and sample payloads, not against live webhook traffic. Please [report issues](https://github.com/mokshupadhyay/india-webhooks/issues), especially payloads that verify in production but fail here, or the reverse.

## Quick start

```ts
import { verifyWebhook } from 'india-webhooks';

const result = await verifyWebhook('razorpay', {
  rawBody,                 // the exact bytes received: string, Uint8Array, Buffer or ArrayBuffer
  headers: request.headers,
  secret: process.env.RAZORPAY_WEBHOOK_SECRET!,
});

if (!result.ok) {
  // 'missing_header' | 'bad_signature' | 'stale_timestamp' | 'malformed_body'
  // | 'unsupported_event' | 'invalid_options' | 'internal_error'
  return new Response(result.reason, { status: 400 });
}

const { event } = result;
if (event.type === 'payment.captured') {
  await markPaid(event.payment!.orderId, event.payment!.amountMinor); // "50000" for ₹500
}
```

Import only one gateway:

```ts
import { verifyCashfreeWebhook } from 'india-webhooks/cashfree';

const result = await verifyCashfreeWebhook({ rawBody, headers, secret: process.env.CASHFREE_CLIENT_SECRET! });
```

PhonePe and Juspay authenticate with the username and password you set in their dashboards, so they take `credentials` instead of `secret`:

```ts
await verifyWebhook('phonepe', { rawBody, headers, credentials: { username, password } });
```

## Getting the raw body

Signatures cover the exact bytes the gateway sent. If a body parser has already turned them into an object, re-serialising will not give the same bytes back. Cashfree's docs give one example: `"payment_amount": 170.00` becomes `170`. Read the raw body before any parser runs. Passing a parsed object returns `invalid_options`.

PayU and Easebuzz post `application/x-www-form-urlencoded` and the others post JSON, so the examples below accept any content type.

**Express**

```ts
import express from 'express';

app.post('/webhooks/razorpay', express.raw({ type: '*/*' }), async (req, res) => {
  const result = await verifyWebhook('razorpay', {
    rawBody: req.body, // a Buffer, which is a Uint8Array
    headers: req.headers,
    secret: process.env.RAZORPAY_WEBHOOK_SECRET!,
  });
  res.sendStatus(result.ok ? 200 : 400);
});
```

Register the route before any global `express.json()` or `express.urlencoded()`, or exclude it from them.

**Next.js route handlers** (`app/api/webhooks/cashfree/route.ts`)

```ts
export async function POST(request: Request) {
  const result = await verifyWebhook('cashfree', {
    rawBody: new Uint8Array(await request.arrayBuffer()),
    headers: request.headers,
    secret: process.env.CASHFREE_CLIENT_SECRET!,
  });
  return new Response(null, { status: result.ok ? 200 : 400 });
}
```

Do not call `request.json()` or `request.formData()` first. The body can be read only once.

**Hono**

```ts
app.post('/webhooks/payu', async (c) => {
  const result = await verifyWebhook('payu', {
    rawBody: new Uint8Array(await c.req.arrayBuffer()),
    headers: c.req.raw.headers,
    secret: c.env.PAYU_SALT,
  });
  return c.body(null, result.ok ? 200 : 400);
});
```

**Fastify**

```ts
app.register((scope, _opts, done) => {
  // Encapsulated: only routes in this plugin receive raw Buffers.
  scope.removeAllContentTypeParsers();
  scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, next) => next(null, body));

  scope.post('/webhooks/easebuzz', async (request, reply) => {
    const result = await verifyWebhook('easebuzz', {
      rawBody: request.body as Buffer,
      headers: request.headers,
      secret: process.env.EASEBUZZ_SALT!,
    });
    return reply.code(result.ok ? 200 : 400).send();
  });
  done();
});
```

`string` bodies are encoded as UTF-8 before hashing. Pass bytes when you have them: any `ArrayBuffer` or `ArrayBufferView` (`Uint8Array`, Node `Buffer`, `DataView`) is read as the bytes it covers, so `await request.arrayBuffer()` can be passed directly.

## Gateways

| Gateway | You pass | What proves authenticity | Body authenticated | Timestamp | Amount unit sent |
| --- | --- | --- | --- | --- | --- |
| Razorpay | `secret`: webhook secret | `X-Razorpay-Signature`: hex HMAC-SHA256 of the raw body | Yes | No | Integer paise |
| Cashfree | `secret`: client secret | `x-webhook-signature`: base64 HMAC-SHA256 of `x-webhook-timestamp` followed by the raw body | Yes | Yes, milliseconds, 300 s default | Rupees, JSON number |
| PhonePe | `credentials` | `Authorization`: hex SHA-256 of `username:password` | **No** | No | Integer paisa |
| PayU | `secret`: merchant salt | `hash` form field: SHA-512 of `SALT\|status\|\|\|\|\|\|udf5…udf1\|email\|firstname\|productinfo\|amount\|txnid\|key` | Hashed fields only | No | Rupees, decimal string |
| Juspay | `credentials` | `Authorization: Basic` base64 of `username:password` | **No** | No | Rupees, JSON number |
| Easebuzz | `secret`: merchant salt | `hash` form field: SHA-512 of `salt\|status\|udf10…udf1\|email\|firstname\|productinfo\|amount\|txnid\|key` | Hashed fields only | No | Rupees, decimal string |

Mapped event types:

| Gateway | `payment.*` | `refund.*` |
| --- | --- | --- |
| Razorpay | `payment.authorized`, `payment.captured`, `payment.failed`, `payment.pending` | `refund.created`, `refund.processed`, `refund.failed` |
| Cashfree | `PAYMENT_SUCCESS_WEBHOOK` → captured; `PAYMENT_FAILED_WEBHOOK`, `PAYMENT_USER_DROPPED_WEBHOOK` → failed | `REFUND_STATUS_WEBHOOK`, `AUTO_REFUND_STATUS_WEBHOOK` with `refund_status: "SUCCESS"` → processed |
| PhonePe | `checkout.order.completed` → captured; `checkout.order.failed` → failed | `pg.refund.completed` → processed; `pg.refund.failed` → failed |
| PayU | `status=success` → captured; `failure` → failed; `pending` → pending | Not verifiable (see below) |
| Juspay | `ORDER_SUCCEEDED` → captured; `ORDER_FAILED` → failed; `ORDER_AUTHORIZED` → authorized | `ORDER_REFUNDED` → processed; `ORDER_REFUND_FAILED` → failed; `REFUND_INITIATED` → created |
| Easebuzz | `status` compared lowercased: `success` → captured; `pending` → pending; any other status (`usercancelled`, `failure`, `dropped`, `bounced`, ...) → failed, as Easebuzz's own handler does | Not covered |

PayU's type comes only from the hashed `status`. PayU's docs say to treat only `success` as successful, and its `unmappedstatus` (which tells `auth` from `captured`) is not hashed, so it is in `event.unverified` and never changes the type.

For Juspay refund events, `event.refund` is the most recently created entry of `content.order.refunds` whose status matches the event: `SUCCESS` for `ORDER_REFUNDED`, `FAILURE` for `ORDER_REFUND_FAILED`, `PENDING` for `REFUND_INITIATED`. If there is none, the result is `malformed_body`.

Anything else verifies normally and comes back as `type: 'unknown'` with `raw` intact, so you can still handle it yourself.

## What this cannot protect you from

Read this section before you rely on a gateway's result.

- **PhonePe and Juspay do not sign the body.** Their headers prove the sender knows your dashboard credentials. They do not prove the body is unchanged, and the PhonePe header is the same on every request. If those credentials or one captured request leak, anyone can send any body. Treat these webhooks as a prompt to fetch the order status from the gateway's API before you fulfil an order.
- **PayU and Easebuzz hash only some fields.** `status`, `amount`, `txnid`, `key`, `email`, `firstname`, `productinfo` and the UDFs (PayU: `udf1` to `udf5`; Easebuzz: `udf1` to `udf10`) are covered. Fields such as `mihpayid`, `easepayid`, `mode`, `bank_ref_num` and `unmappedstatus` are not. `event.type`, `event.id` and `amountMinor` use hashed fields only. Every field the hash does not cover is copied into `event.unverified`, so it is clear which values anyone could have changed. `payment.id` and `payment.method` come from unhashed fields too. A body in which any field name appears more than once is rejected with `malformed_body`, even if the copies are equal, because another parser might read the other copy.
- **Replay protection exists only for Cashfree**, the only scheme here with a signed timestamp. For the others a captured request verifies again forever. De-duplicate on `event.id` and check the order state before acting.
- **Event ids.** `event.id` is built only from body fields, and for Razorpay, Cashfree, PayU and Easebuzz only from fields the signature or hash covers. For PhonePe and Juspay nothing in the body is authenticated, so neither is `event.id`. A redelivery of the same body gets the same `event.id`. The gateways' own delivery ids, `x-razorpay-event-id` and Cashfree's `x-idempotency-key`, are headers the signature does not cover, so they are only in `event.deliveryId`: fine for logging, not for de-duplication. Two different events about the same payment with the same event name and the same timestamp would get the same `event.id`; see the table below for exactly what goes into it.
- **No `occurredAt` for PayU and Easebuzz.** Their `addedon` time has no time zone, so it stays in `raw` and `occurredAt` is `null`.

### What each field is based on

"Signed" means the field is covered by the gateway's signature or hash, so it cannot be changed without failing verification.

| Gateway | `event.id` | `event.type` | `amountMinor` | Signed |
| --- | --- | --- | --- | --- |
| Razorpay | `event` : the refund or payment entity's `id` (other events: the first entity in `contains`) : `created_at` | `event` | `payload.payment.entity.amount`, `payload.refund.entity.amount` | Yes, the whole body |
| Cashfree | `type` : `data.payment.cf_payment_id` or the refund's `cf_refund_id` : `event_time` | `type`, and `refund_status` for refunds | `data.payment.payment_amount`, `data.refund.refund_amount` (or `auto_refund`) | Yes, the whole body and `x-webhook-timestamp` |
| PhonePe | `event` : `payload.refundId` or `payload.orderId` : `payload.state` | `event` | `payload.amount` | **No.** Only the credentials are checked |
| PayU | `txnid` : `status` | `status` | `amount` | Yes, all three are hashed |
| Juspay | `id`, or `event_name` : `content.order.id` when `id` is absent | `event_name`; the refund is chosen by `refunds[].status` | `content.order.amount`, `content.order.refunds[].amount` | **No.** Only the credentials are checked |
| Easebuzz | `txnid` : `status` | `status`, lowercased | `amount` | Yes, all three are hashed |

Fields that are never signed, for any gateway:

- `event.deliveryId`: the `x-razorpay-event-id` or `x-idempotency-key` header, or `null` for the other gateways.
- `event.unverified` (PayU and Easebuzz), and for those two `payment.id` (`mihpayid`, `easepayid`) and `payment.method` (`mode`).
- Everything from PhonePe and Juspay, including `occurredAt`.

## Left out, and why

This package leaves out anything that could not be confirmed from an official source. Every gateway is included, but these parts are not:

- **PhonePe HMAC webhooks** (`x-phonepe-checksum-key-id`, `x-phonepe-checksum-signature`). The docs say the payload is "encrypted" with a secret key but do not name the hash, the encoding or the exact signed bytes, and the official SDK has no code for it. PhonePe's older v1 `X-VERIFY` callbacks are also not supported.
- **PayU refund and dispute webhooks.** They are JSON, and the docs show no hash, signature or authentication header for them. They return `missing_header`, with a message that says why, because nothing in them can be checked. PayU's split-payment reverse hash (`splitInfo`) is not implemented.
- **Juspay JWT (JWE + JWS) webhooks** return `unsupported_event`.
- **Cashfree Payouts V1 (Cashgram)** form-encoded signatures.
- **Easebuzz documentation.** docs.easebuzz.in renders only with JavaScript and blocked automated requests, so it could not be read. The Easebuzz scheme here matches Easebuzz's own published webhook handler (its WooCommerce plugin) and its Node kit, which use the same hash sequence. Easebuzz publishes no test vector. One difference: the plugin URL-decodes the body twice. This package decodes it once, as the form encoding requires. The two differ only for values that contain an encoded `%` or `+`.

## API

### `verifyWebhook(provider, options)`

Returns `Promise<VerifyResult>` and never rejects.

| Option | | |
| --- | --- | --- |
| `rawBody` | required | `string`, `ArrayBuffer`, or any `ArrayBufferView` such as `Uint8Array`, Node `Buffer` or `DataView` |
| `headers` | | Fetch `Headers`, a `Map`, any object with `entries()` or `forEach`, or a plain object such as Node's `req.headers`. Names are matched case-insensitively for all of them |
| `secret` | Razorpay, Cashfree, PayU, Easebuzz | Webhook secret, client secret or merchant salt. Empty or whitespace-only is `invalid_options` |
| `credentials` | PhonePe, Juspay | `{ username, password }` from the gateway dashboard. An empty or whitespace-only username or password is `invalid_options`, because anyone can compute the header for empty credentials |
| `now` | | `Date` or milliseconds. Default `Date.now()`. Used only by Cashfree |
| `toleranceSeconds` | | Allowed difference between `now` and the signed timestamp. Default 300 (Cashfree's guidance). Used only by Cashfree |

The per-gateway functions `verifyRazorpayWebhook`, `verifyCashfreeWebhook`, `verifyPhonepeWebhook`, `verifyPayuWebhook`, `verifyJuspayWebhook` and `verifyEasebuzzWebhook` take the same options.

### Failure reasons

| `reason` | When |
| --- | --- |
| `missing_header` | The signature header, Cashfree's timestamp header, or the PayU or Easebuzz `hash` field is missing. A JSON or other non-form body sent to PayU or Easebuzz has no `hash` field, so it gets this reason too |
| `bad_signature` | The signature, hash or credentials do not match |
| `stale_timestamp` | Cashfree's signature matched, but its timestamp is outside `toleranceSeconds` or is not a number |
| `malformed_body` | Authentication passed, but the body is not JSON or form data, a mapped event lacks its fields, an amount is not exact, or a PayU or Easebuzz field appears more than once |
| `unsupported_event` | Authentication passed, but the delivery is a kind this package cannot read (Juspay JWT bodies) |
| `invalid_options` | A missing, empty or whitespace-only secret or credential, a parsed `rawBody`, an unknown provider, or a bad `now` or `toleranceSeconds` |
| `internal_error` | Something unexpected, such as no Web Crypto in the runtime |

`stale_timestamp`, `malformed_body` and `unsupported_event` are returned only after the signature, hash or credentials have matched. A request that fails authentication gets `missing_header` or `bad_signature`, unless the call itself is wrong (`invalid_options`) or something unexpected fails (`internal_error`). So it is safe to answer `missing_header` and `bad_signature` with an error status and never acknowledge them. Each failure also has a human-readable `message`. Do not send it back to the caller.

### The event

```ts
interface WebhookEvent {
  provider: 'razorpay' | 'cashfree' | 'phonepe' | 'payu' | 'juspay' | 'easebuzz';
  type: 'payment.authorized' | 'payment.captured' | 'payment.failed' | 'payment.pending'
      | 'refund.created' | 'refund.processed' | 'refund.failed' | 'unknown';
  id: string;                  // from signed body fields; see "What each field is based on"
  deliveryId: string | null;   // unsigned delivery id header (Razorpay, Cashfree); logging only
  occurredAt: string | null;   // ISO 8601, when the payload has an unambiguous time
  providerType: string | null; // the gateway's own event name or status
  payment?: { id, orderId, amountMinor, currency, status, method };
  refund?: { id, paymentId, orderId, amountMinor, currency, status };
  unverified?: Record<string, string>; // PayU, Easebuzz: every field the hash does not cover
  raw: JsonObject;             // parsed JSON, or form fields as strings
}
```

`status` and `method` are the gateway's own strings, unchanged. `currency` is `null` when the gateway does not send one (PayU, Easebuzz). PhonePe sends none either, but documents paisa, so it is set to `INR`.

`amountMinor` is a string of digits with no leading zeros, converted without float arithmetic and never rounded:

- **Paise (Razorpay, PhonePe).** A JSON number must be a non-negative integer no larger than 2^53 − 1 (`Number.MAX_SAFE_INTEGER`). A string of digits is accepted at any length and kept exact.
- **Rupees (Cashfree, Juspay, PayU, Easebuzz).** Converted as decimal text: `1.8` becomes `"180"` and `"40.00"` becomes `"4000"`. A JSON number must be non-negative, no larger than 2^53 − 1 if it is a whole number, and below 10^13 rupees if it has a fraction, because beyond that a double may not hold the digits that were sent. A decimal string (PayU and Easebuzz always send strings) is accepted at any length and kept exact.
- Anything else is `malformed_body`: negative amounts, a third non-zero decimal (`"12.345"`), and in strings, signs, exponents, spaces and thousands separators. A JSON number written with an exponent, such as `1e3`, is already the number 1000 when it is parsed, so it is read as 1000.

So `amountMinor` can be larger than `Number.MAX_SAFE_INTEGER`. Do not convert it with `Number()` or `parseInt()`, which silently lose digits above 2^53. Compare it as a string with your own stored amount in paise, or use `BigInt(event.payment.amountMinor)`.

## Test kit

```ts
import { scenarios, signWebhook } from 'india-webhooks/testing';

const request = await signWebhook('cashfree', payload, 'test_secret', { timestamp: Date.now() });
// { headers: { 'x-webhook-signature': ..., 'x-webhook-timestamp': ..., ... }, rawBody: '...' }
await fetch('http://localhost:3000/webhooks/cashfree', { method: 'POST', ...request, body: request.rawBody });
```

`signWebhook(provider, payload, secret, options?)` uses the same scheme code as the verifiers. `payload` is a JSON object or exact JSON text, or form fields for PayU and Easebuzz. `secret` is `{ username, password }` for PhonePe and Juspay. Options: `timestamp` (Cashfree), `eventId` (Razorpay's `x-razorpay-event-id`, which verifies to `event.deliveryId`), `idempotencyKey` and `webhookVersion` (Cashfree). Blank secrets and credentials throw, because the verifiers reject them.

`scenarios(provider, events, secret, options?)` returns deliveries, each with `headers`, `rawBody`, the `kind`, the `eventIndex` it carries, and the `expected` result of verifying it:

| `kind` | | `expected` |
| --- | --- | --- |
| `original` | each event once | `ok` |
| `duplicate` | each event again, byte for byte | `ok` |
| `out_of_order` | all events in reverse order (two or more events) | `ok` |
| `late` | the first event after the rest; for Cashfree signed `lateBySeconds` ago, inside the tolerance | `ok` |
| `tampered` | the first event with one character changed in the body (Razorpay, Cashfree), a hashed field (PayU, Easebuzz) or the `Authorization` header (PhonePe, Juspay) | `bad_signature` |
| `stale` | Cashfree only: the first event signed 60 s outside the tolerance | `stale_timestamp` |

```ts
for (const delivery of await scenarios('razorpay', [captured, failed], 'test_secret')) {
  const res = await post('/webhooks/razorpay', delivery);
  expect(res.status).toBe(delivery.expected === 'ok' ? 200 : 400);
}
// Then assert the order was updated once, and ended in the right state.
```

Unlike the verifiers, the test kit throws on invalid arguments.

## Runtimes

The code targets Node 18+, Bun, Deno and edge runtimes. Hashing uses the global `crypto.subtle`. Where that global is missing (Node 18), it falls back to `node:crypto`'s `webcrypto`, loaded only at that moment through a dynamic import that bundlers are told to ignore. Edge bundles never reference `node:crypto`. Bodies, headers and base64 use only `TextEncoder`, `TextDecoder` and `URLSearchParams`.

What has been run: the test suite on Node 24, and the built CommonJS and ES module output on Node 24 with `globalThis.crypto` and `process.getBuiltinModule` removed, to exercise the Node 18 fallback. Bun, Deno, Cloudflare Workers, Vercel Edge and a real Node 18 have **not** been run yet.

The package ships CommonJS (`lib/commonjs`), ES modules (`lib/module`) and type declarations for both (`lib/typescript`), compiled to ES2017.

## How it works

- `src/providers/*.ts` hold one gateway each: the scheme function that computes the expected signature, the verifier, and the normaliser. The test kit calls the same scheme functions to sign.
- `src/providers/form.ts` is shared by PayU and Easebuzz, which differ only in the hash sequence and status mapping. It checks the hash before anything else and rejects repeated field names after it.
- `src/core/crypto.ts` loads Web Crypto. `src/core/bytes.ts` has hex, base64 and the constant-time comparison. `src/core/amount.ts` converts amounts as decimal strings.
- Verifiers authenticate first, then parse, then normalise. Any exception becomes a failure result.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

Tests include each gateway's published test vector where one exists, sign-then-verify round trips, one-character tampering of the body, the signature and each signed header, wrong secrets, Cashfree's timestamp window, and amount conversion. Property tests use [fast-check](https://github.com/dubzzz/fast-check). They also check that a request without valid authentication only ever gets `missing_header` or `bad_signature`, and that `verifyWebhook` never throws or rejects for arbitrary `provider` and `options` values. `src/__tests__/regressions.test.ts` covers the fixes made after review. [docs/MUTATION_EVIDENCE.md](docs/MUTATION_EVIDENCE.md) shows each property failing against a deliberate bug.

## License

MIT
