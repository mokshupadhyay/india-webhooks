# Sources

Every signing rule in this package comes from the gateway's own documentation or its official SDK. All pages and code below were read on **2026-11-22**. Where an official SDK contains verification code, the implementation here matches it byte for byte, and its published test values are used as test vectors.

"Not supported" below means the scheme exists but could not be confirmed precisely enough from an official source, so this package leaves it out instead of guessing.

## Razorpay

| | |
| --- | --- |
| Docs | https://razorpay.com/docs/webhooks/validate-test/ (validation, idempotency, ordering) |
| | https://razorpay.com/docs/webhooks/payments/ and https://razorpay.com/docs/webhooks/refunds/ (event names, sample payloads) |
| Official SDK | `razorpay` 2.9.8 on npm, `dist/utils/razorpay-utils.js`, `validateWebhookSignature` (also https://github.com/razorpay/razorpay-node `lib/utils/razorpay-utils.js`) |
| Headers | `X-Razorpay-Signature` (signature). `x-razorpay-event-id` (unique per event, for de-duplication) |
| Signed message | The raw request body, nothing else |
| Algorithm | HMAC-SHA256, key = webhook secret |
| Encoding | Lowercase hex |
| Timestamp / replay | None in the signature. Docs say the same event can arrive more than once and out of order; de-duplicate with `x-razorpay-event-id` |
| Amounts | Integers in the smallest currency unit (paise), for example `"amount": 50000` for ₹500 |
| Test vector | SDK test `test/utils/razorpay-utils.spec.js`: body `{"a":1,"b":2,"c":{"d":3}}`, secret `123456`, signature `2fe04e22977002e6c7cb553adab8b460cb9e2a4970d5953cb27a8472752e3bbc`. Recomputed with `openssl dgst -sha256 -hmac 123456` before use |
| Events mapped | `payment.authorized`, `payment.captured`, `payment.failed`, `payment.pending`, `refund.created`, `refund.processed`, `refund.failed`. Everything else (for example `order.paid`, `refund.speed_changed`, downtime events) is `unknown` |
| Event id | `x-razorpay-event-id` is not covered by the signature, so it is exposed only as `event.deliveryId`. `event.id` is `event:entity id:created_at`, all from the signed body |

## Cashfree Payments (Payment Gateway)

| | |
| --- | --- |
| Docs | https://www.cashfree.com/docs/payments/online/webhooks/signature-verification |
| | https://www.cashfree.com/docs/api-reference/webhooks/payloads-and-signatures |
| | https://www.cashfree.com/docs/api-reference/webhooks/reliability-and-operations (replay rule, retries, `x-idempotency-key`) |
| | https://www.cashfree.com/docs/api-reference/payments/latest/payments/webhooks (payment events, sample headers and payloads) |
| | https://www.cashfree.com/docs/api-reference/payments/latest/refunds/webhooks (refund events) |
| Official SDK | `cashfree-pg` 6.0.6 on npm, `dist/api.js`, `PGVerifyWebhookSignature` |
| Headers | `x-webhook-signature` (signature), `x-webhook-timestamp` (milliseconds since epoch, for example `1785401067911`). Also sent: `x-webhook-version`, `x-webhook-attempt`, and `x-idempotency-key` on version `2025-01-01` and later |
| Signed message | `x-webhook-timestamp` header value immediately followed by the raw body, no separator |
| Algorithm | HMAC-SHA256, key = Cashfree PG client secret (partner webhooks use the partner API key) |
| Encoding | Standard base64 |
| Timestamp / replay | Reliability page: "reject requests where the timestamp is older than five minutes". The default `toleranceSeconds` is therefore 300 |
| Amounts | Rupees as JSON numbers with decimals, for example `"payment_amount": 1.8`. The docs warn that re-serialising turns `170.00` into `170` and breaks the signature |
| Test vector | None published with a known secret. Sample headers on the docs page have signatures, but the secret is not given |
| Events mapped | `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`, `PAYMENT_USER_DROPPED_WEBHOOK`, `REFUND_STATUS_WEBHOOK` and `AUTO_REFUND_STATUS_WEBHOOK` when `refund_status` is `SUCCESS` (the only status value shown in the samples; the docs mention cancelled refunds but not the exact string). Other refund statuses and other events, including `PAYMENT_CHARGES_WEBHOOK`, are `unknown` |
| Not supported | Payouts V1 Cashgram form-encoded signatures |
| Event id | `x-idempotency-key` is not covered by the signature, so it is exposed only as `event.deliveryId`. `event.id` is `type:cf_payment_id or cf_refund_id:event_time`, all from the signed body |

## PhonePe Payment Gateway (Standard Checkout v2)

| | |
| --- | --- |
| Docs | https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook |
| | https://developer.phonepe.com/payment-gateway/backend-sdk/python-be-sdk/sdk-reference-python/webhook-handling |
| Official SDK | `@phonepe-pg/pg-sdk-node` 2.0.6 on npm, `dist/common/CommonUtils.js` (`isCallbackValid`, `calculateSha256`) and `dist/payments/v2/StandardCheckoutClient.js` (`validateCallback`). Tests: https://github.com/PhonePe/phonepe-pg-sdk-node `tests/callback.test.ts`, `tests/utils.test.ts` |
| Headers | `Authorization` |
| Signed message | The string `username:password` (the credentials you configured in the PhonePe dashboard). **The body is not part of it** |
| Algorithm | SHA-256 |
| Encoding | Lowercase hex, compared as-is with the header value (no `Basic`/`Bearer` prefix) |
| Timestamp / replay | None |
| Amounts | Integer paisa (`amount`, "The amount processed in paisa") |
| Test vector | SDK test: username `username`, password `password`, Authorization `bc842c31a9e54efe320d30d948be61291f3ceee4766e36ab25fa65243cd76e0e`; also empty username and password give `e7ac0786668e0ff0f02b62bd04f45ff636fd82db63b1104601c975dc005f3a67`. Both recomputed with `shasum -a 256` |
| Events mapped | `checkout.order.completed`, `checkout.order.failed`, `pg.refund.completed`, `pg.refund.failed` (the docs say to use `event`, not `type`, and `payload.state`) |
| Not supported | The dashboard's newer **HMAC** option (`x-phonepe-checksum-key-id`, `x-phonepe-checksum-signature`). The docs say the payload is "encrypted" with the secret key but do not name the hash function, the encoding, or what exactly is signed, and the official Node SDK has no code for it. The older v1 `X-VERIFY` (SHA-256 of base64 body plus salt key) scheme could not be loaded from the official site during this session and is also left out |

## PayU India

| | |
| --- | --- |
| Docs | https://docs.payu.in/docs/webhook-events-and-sample-payloads (events, sample payloads, content types) |
| | https://docs.payu.in/docs/hashing-request-and-response (section "Hash Validation Logic for Payment Response (Reverse Hashing)") |
| | https://docs.payu.in/reference/transaction-callback-api |
| Official SDK | https://github.com/payu-india/payu-sdk-node `lib/payu/hasher.js` (`validateHash`), commit `085548ca951346b721fd73f2c6a541500b18e170` |
| Headers | None. Payment webhooks are `application/x-www-form-urlencoded` with the hash in the `hash` field |
| Signed message | `SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key`. The five empty slots after `status` are always empty (the SDK hard-codes them). If the payload has `additionalCharges`, the string is prefixed with `additionalCharges|` |
| Algorithm | SHA-512 |
| Encoding | Lowercase hex |
| Timestamp / replay | None |
| Amounts | Rupees as decimal strings, for example `amount=40.00` |
| Test vector | SDK test: key `bjg$121`, salt `vhgvs75`, txnid `3123`, amount `1000`, productinfo `mobile`, firstname `Jacob`, email `test@payu.in`, status `success`, hash `687c82156a84271a7a6c63d0e8774d5ac567d9b894a334a47d72e47b72392a5167a1b2add5b253490b70731d9eb3e3a3b7225e0c5f26829befafbbee71977c4c`. Recomputed with `shasum -a 512` |
| Events mapped | Form payloads by the hashed `status` only: `success` (`payment.captured`), `failure` (`payment.failed`), `pending` (`payment.pending`). The docs say "Treat only success as successful". `unmappedstatus` (for example `auth` or `captured`) is not hashed, so it never changes the type; it is in `event.unverified` |
| Not supported | Refund and dispute webhooks. They are JSON and the docs show no hash, signature or authentication header for them, so they cannot be verified and come back as `missing_header` (no hash). The split-payment variant of the reverse hash (`splitInfo`) is not implemented |
| Limit | Only the fields in the hash are authenticated. `mihpayid`, `mode`, `bank_ref_num`, `unmappedstatus` and others are not covered by the hash; they are listed in `event.unverified`. A body in which any field name appears more than once is rejected |

## Juspay (Express Checkout / HyperCheckout)

| | |
| --- | --- |
| Docs | https://juspay.io/in/docs/api-reference/docs/express-checkout/webhooks (authentication) |
| | https://juspay.io/in/docs/payv3/web/base-integration/webhooks.md (event list and sample payloads) |
| | https://juspay.io/in/docs/resources/docs/common-resources/webhook-events-and-sample-payloads.md (payload structure) |
| | https://juspay.io/in/docs/api-reference/docs/express-checkout/create-order-api.md (amount unit) |
| Official SDK | Not used; the docs describe the check completely |
| Headers | `Authorization: Basic <base64 of username:password>` |
| Signed message | Nothing is signed. The header carries the username and password you configured in the Juspay dashboard. **The body is not authenticated** |
| Algorithm | None (HTTP Basic authentication) |
| Encoding | Base64 |
| Timestamp / replay | None. Docs: the same webhook can arrive more than once |
| Amounts | Rupees, "stringified double or integer values with upto two decimal places"; webhooks carry JSON numbers such as `"amount": 8` |
| Test vector | None published |
| Events mapped | `ORDER_SUCCEEDED`, `ORDER_FAILED`, `ORDER_AUTHORIZED`, `ORDER_REFUNDED`, `ORDER_REFUND_FAILED`, `REFUND_INITIATED`. Others (`TXN_*`, mandate, notification and `AUTO_REFUND_*` events) are `unknown` |
| Refund chosen | https://juspay.io/in/docs/resources/docs/common-resources/refunds, section "Refund Status": `PENDING` (initial status of every refund), `SUCCESS`, `FAILURE`, `MANUAL_REVIEW`. `ORDER_REFUNDED` reports the most recently `created` refund with status `SUCCESS`, `ORDER_REFUND_FAILED` the most recent `FAILURE`, `REFUND_INITIATED` the most recent `PENDING`. No matching refund is `malformed_body` |
| Not supported | JWT (JWE + JWS) encrypted webhooks |

## Easebuzz

| | |
| --- | --- |
| Docs | https://docs.easebuzz.in/ could not be read: it is a JavaScript-only site and `llms.txt` returned HTTP 403 behind Cloudflare |
| Official SDK | Easebuzz's own WooCommerce plugin, https://github.com/easebuzz/paywitheasebuzz-wordpress-woocommerce-lib `woocommerce_easebuzz_plugin.zip`, plugin version 5.8.0: `update_webhook.php` (the webhook handler) and `easepay-lib.php` (`easebuzz_compute_reverse_hash`) |
| | Easebuzz's Node kit, https://github.com/easebuzz/paywitheasebuzz-nodejs-lib commit `a7f8409f535f74df7de8b5789dd848045981ca28`, `Easebuzz_NodeJS_kit/easebuzz-lib/utils.js` (`_getReverseHashKey`), same sequence |
| Headers | None. The body is form-encoded and the hash is in the `hash` field |
| Signed message | `salt|status|udf10|udf9|udf8|udf7|udf6|udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key`, missing fields as empty strings |
| Algorithm | SHA-512 |
| Encoding | Lowercase hex |
| Timestamp / replay | None |
| Amounts | Rupees as decimal strings (the same `amount` that was sent at payment initiation) |
| Test vector | None published |
| Events mapped | By `status`, lowercased first, exactly as the plugin's `easebuzz_apply_payment_status` in `easepay-lib.php` (called from `update_webhook.php` line 65): line 86 `$status = strtolower((string) $status);`, line 90 `case 'success'` (order paid, `payment.captured`), line 101 `case 'pending'` (`payment.pending`), line 110 `case 'usercancelled'` (order cancelled) and line 119 `default` (order failed) both become `payment.failed`. So `failure`, `dropped`, `bounced` and any other status are `payment.failed` |
| Note | The plugin decodes the body twice (`parse_str(urldecode($body))`). This package decodes it once, as `application/x-www-form-urlencoded` requires. The two only differ for values containing an encoded `%` or `+` |
| Limit | Only the fields in the hash are authenticated; `easepayid`, `mode` and others are not. They are listed in `event.unverified`. A body in which any field name appears more than once is rejected |
