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
  rawBody,                 // the exact bytes received: string or Uint8Array
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

`string` bodies are encoded as UTF-8 before hashing. Pass bytes when you have them.

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
| PayU | `status=success` → captured, or authorized when `unmappedstatus=auth`; `failure` → failed; `pending` → pending | Not verifiable (see below) |
| Juspay | `ORDER_SUCCEEDED` → captured; `ORDER_FAILED` → failed; `ORDER_AUTHORIZED` → authorized | `ORDER_REFUNDED` → processed; `ORDER_REFUND_FAILED` → failed; `REFUND_INITIATED` → created |
| Easebuzz | `status=success` → captured; `pending` → pending; `usercancelled` → failed | Not covered |

Anything else verifies normally and comes back as `type: 'unknown'` with `raw` intact, so you can still handle it yourself.

## What this cannot protect you from

Read this section before you rely on a gateway's result.

- **PhonePe and Juspay do not sign the body.** Their headers prove the sender knows your dashboard credentials. They do not prove the body is unchanged, and the PhonePe header is the same on every request. If those credentials or one captured request leak, anyone can send any body. Treat these webhooks as a prompt to fetch the order status from the gateway's API before you fulfil an order.
- **PayU and Easebuzz hash only some fields.** `status`, `amount`, `txnid`, `key`, `email`, `firstname`, `productinfo` and the UDFs are covered. Fields such as `mihpayid`, `easepayid`, `mode`, `bank_ref_num` and `unmappedstatus` are not. The `payment.authorized` type for PayU comes from `unmappedstatus` and is therefore unauthenticated. If a hashed field appears twice with different values, verification fails with `malformed_body` instead of guessing which one PayU meant.
- **Replay protection exists only for Cashfree**, the only scheme here with a signed timestamp. For the others a captured request verifies again forever. De-duplicate on `event.id` and check the order state before acting.
- **Event ids.** `event.id` is the gateway's event id where one is sent (`x-razorpay-event-id`, Cashfree's `x-idempotency-key`, Juspay's `id`). Otherwise it is built from payload fields, for example `txnid:status` for PayU. It is stable across redeliveries of the same event. It is authenticated only where the scheme authenticates those fields.
- **No `occurredAt` for PayU and Easebuzz.** Their `addedon` time has no time zone, so it stays in `raw` and `occurredAt` is `null`.

## Left out, and why

This package leaves out anything that could not be confirmed from an official source. Every gateway is included, but these parts are not:

- **PhonePe HMAC webhooks** (`x-phonepe-checksum-key-id`, `x-phonepe-checksum-signature`). The docs say the payload is "encrypted" with a secret key but do not name the hash, the encoding or the exact signed bytes, and the official SDK has no code for it. PhonePe's older v1 `X-VERIFY` callbacks are also not supported.
- **PayU refund and dispute webhooks.** They are JSON, and the docs show no hash, signature or authentication header for them. They return `unsupported_event`. PayU's split-payment reverse hash (`splitInfo`) is not implemented.
- **Juspay JWT (JWE + JWS) webhooks** return `unsupported_event`.
- **Cashfree Payouts V1 (Cashgram)** form-encoded signatures.
- **Easebuzz documentation.** docs.easebuzz.in renders only with JavaScript and blocked automated requests, so it could not be read. The Easebuzz scheme here matches Easebuzz's own published webhook handler (its WooCommerce plugin) and its Node kit, which use the same hash sequence. Easebuzz publishes no test vector. One difference: the plugin URL-decodes the body twice. This package decodes it once, as the form encoding requires. The two differ only for values that contain an encoded `%` or `+`.

## API

### `verifyWebhook(provider, options)`

Returns `Promise<VerifyResult>` and never rejects.

| Option | | |
| --- | --- | --- |
| `rawBody` | required | `string` or `Uint8Array` (a Node `Buffer` works) |
| `headers` | | Fetch `Headers`, or a plain object such as Node's `req.headers`. Matched case-insensitively |
| `secret` | Razorpay, Cashfree, PayU, Easebuzz | Webhook secret, client secret or merchant salt |
| `credentials` | PhonePe, Juspay | `{ username, password }` from the gateway dashboard |
| `now` | | `Date` or milliseconds. Default `Date.now()`. Used only by Cashfree |
| `toleranceSeconds` | | Allowed difference between `now` and the signed timestamp. Default 300 (Cashfree's guidance). Used only by Cashfree |

The per-gateway functions `verifyRazorpayWebhook`, `verifyCashfreeWebhook`, `verifyPhonepeWebhook`, `verifyPayuWebhook`, `verifyJuspayWebhook` and `verifyEasebuzzWebhook` take the same options.

### Failure reasons

| `reason` | When |
| --- | --- |
| `missing_header` | The signature header, Cashfree's timestamp header, or the PayU or Easebuzz `hash` field is missing |
| `bad_signature` | The signature, hash or credentials do not match |
| `stale_timestamp` | Cashfree's signed timestamp is outside `toleranceSeconds`, or is not a number |
| `malformed_body` | The body is authentic but is not JSON or form data, a mapped event lacks its fields, or an amount is not exact |
| `unsupported_event` | A kind of delivery this package cannot verify (PayU JSON refunds, Juspay JWT) |
| `invalid_options` | A missing or empty secret, missing credentials, a parsed `rawBody`, or a bad `now` or `toleranceSeconds` |
| `internal_error` | Something unexpected, such as no Web Crypto in the runtime |

Authentication is always checked before the body is parsed, so an unauthenticated request never gets `malformed_body`. Each failure also has a human-readable `message`. Do not send it back to the caller.

### The event

```ts
interface WebhookEvent {
  provider: 'razorpay' | 'cashfree' | 'phonepe' | 'payu' | 'juspay' | 'easebuzz';
  type: 'payment.authorized' | 'payment.captured' | 'payment.failed' | 'payment.pending'
      | 'refund.created' | 'refund.processed' | 'refund.failed' | 'unknown';
  id: string;                  // see "Event ids" above
  occurredAt: string | null;   // ISO 8601, when the payload has an unambiguous time
  providerType: string | null; // the gateway's own event name or status
  payment?: { id, orderId, amountMinor, currency, status, method };
  refund?: { id, paymentId, orderId, amountMinor, currency, status };
  raw: JsonObject;             // parsed JSON, or form fields as strings
}
```

`status` and `method` are the gateway's own strings, unchanged. `currency` is `null` when the gateway does not send one (PayU, Easebuzz). PhonePe sends none either, but documents paisa, so it is set to `INR`.

`amountMinor` is a string of digits. Integer amounts (Razorpay, PhonePe) are taken as they are. Rupee amounts (Cashfree, Juspay, PayU, Easebuzz) are converted as decimal text: `1.8` becomes `"180"` and `"40.00"` becomes `"4000"`. Amounts with a third non-zero decimal, negative amounts, and integers above 2^53 are reported as `malformed_body`, never rounded.

## Test kit

```ts
import { scenarios, signWebhook } from 'india-webhooks/testing';

const request = await signWebhook('cashfree', payload, 'test_secret', { timestamp: Date.now() });
// { headers: { 'x-webhook-signature': ..., 'x-webhook-timestamp': ..., ... }, rawBody: '...' }
await fetch('http://localhost:3000/webhooks/cashfree', { method: 'POST', ...request, body: request.rawBody });
```

`signWebhook(provider, payload, secret, options?)` uses the same scheme code as the verifiers. `payload` is a JSON object or exact JSON text, or form fields for PayU and Easebuzz. `secret` is `{ username, password }` for PhonePe and Juspay. Options: `timestamp` (Cashfree), `eventId` (Razorpay), `idempotencyKey` and `webhookVersion` (Cashfree).

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
- `src/providers/form.ts` is shared by PayU and Easebuzz, which differ only in the hash sequence and status mapping.
- `src/core/crypto.ts` loads Web Crypto. `src/core/bytes.ts` has hex, base64 and the constant-time comparison. `src/core/amount.ts` converts amounts as decimal strings.
- Verifiers authenticate first, then parse, then normalise. Any exception becomes a failure result.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

Tests include each gateway's published test vector where one exists, sign-then-verify round trips, one-character tampering of the body, the signature and each signed header, wrong secrets, Cashfree's timestamp window, and amount conversion. Property tests use [fast-check](https://github.com/dubzzz/fast-check). [docs/MUTATION_EVIDENCE.md](docs/MUTATION_EVIDENCE.md) shows each property failing against a deliberate bug.

## License

MIT
