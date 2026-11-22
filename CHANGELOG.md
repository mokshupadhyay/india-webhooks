# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-22

### Added

- `verifyWebhook(provider, options)` for Razorpay, Cashfree Payments, PhonePe Payment Gateway, PayU India, Juspay and Easebuzz. It returns `{ ok: true, event }` or `{ ok: false, reason, message }` and never throws.
- Failure reasons: `missing_header`, `bad_signature`, `stale_timestamp`, `malformed_body`, `unsupported_event`, `invalid_options`, `internal_error`.
- A normalised event with `payment` and `refund` details, `amountMinor` as a string of integer paise, `deliveryId`, and `unverified` for PayU and Easebuzz.
- Per-gateway subpath exports: `india-webhooks/razorpay`, `/cashfree`, `/phonepe`, `/payu`, `/juspay`, `/easebuzz`.
- Test kit at `india-webhooks/testing`: `signWebhook` and `scenarios` (original, duplicate, out-of-order, late, tampered and stale deliveries).
- `docs/SOURCES.md` with the official source for every signing rule, and `docs/MUTATION_EVIDENCE.md`.

### Fixed before release

Changes made after a review of the first build, before 0.1.0 was published:

- PhonePe and Juspay reject an empty or whitespace-only username or password with `invalid_options`. Before, empty credentials accepted a forged `Authorization` header (`sha256(":")` or `Basic Og==`). Secrets that are only whitespace are rejected too, and the test kit refuses to sign with either.
- `event.id` is built only from body fields, never from headers. For Razorpay it is `event:entity id:created_at` and for Cashfree `type:entity id:event_time`, all covered by the signature. The unsigned `x-razorpay-event-id` and `x-idempotency-key` headers are now in the new `event.deliveryId` (`string | null`), for logging only.
- PayU: `event.type` depends only on the hashed `status`. `status=success` is always `payment.captured`; `unmappedstatus=auth` no longer makes it `payment.authorized`, because `unmappedstatus` is not hashed. PayU and Easebuzz events have a new `event.unverified` object with every field the hash does not cover. A form body in which any field appears more than once, hashed or not, with the same value or not, is `malformed_body`.
- Juspay refund events choose the most recent refund whose status matches the event (`SUCCESS` for `ORDER_REFUNDED`, `FAILURE` for `ORDER_REFUND_FAILED`, `PENDING` for `REFUND_INITIATED`) instead of the newest refund. No matching refund is `malformed_body`.
- Easebuzz statuses are compared lowercased, and every status other than `success` and `pending` (`usercancelled`, `failure`, `dropped`, `bounced`, ...) is `payment.failed`, as in Easebuzz's own webhook handler. Before, only lowercase `usercancelled` was failed and the rest were `unknown`.
- PayU and Easebuzz bodies without a `hash` field, including JSON bodies and invalid JSON, are `missing_header`. Before, they could get `unsupported_event` or `malformed_body` without any authentication. Repeated fields are checked after the hash, so a wrong hash is always `bad_signature`.
- `verifyWebhook` no longer throws for a provider value that cannot be turned into a string (such as `Object.create(null)`), and no longer rejects when a thrown value cannot be turned into a string.
- `rawBody` accepts an `ArrayBuffer` and any `ArrayBufferView` (such as `DataView`). Headers given as a `Map` or any object with `entries()` or `forEach` are matched case-insensitively.
- README: the amount rules for numbers and strings are stated exactly (digit strings are kept exact at any size), with a warning not to convert `amountMinor` with `Number()`. A new table, "What each field is based on", lists the fields behind `event.id`, `event.type` and `amountMinor` for each gateway and whether they are signed.
- New property tests: a request without valid authentication only gets `missing_header` or `bad_signature`, and `verifyWebhook` never throws or rejects for arbitrary inputs.

### Not supported

- PhonePe HMAC (`x-phonepe-checksum-*`) and v1 `X-VERIFY` webhooks, PayU refund and dispute webhooks (unsigned JSON, reported as `missing_header`), PayU split-payment reverse hashes, Juspay JWT webhooks, and Cashfree Cashgram signatures. See the README for the reasons.

[0.1.0]: https://github.com/mokshupadhyay/india-webhooks/releases/tag/v0.1.0
