# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-22

### Added

- `verifyWebhook(provider, options)` for Razorpay, Cashfree Payments, PhonePe Payment Gateway, PayU India, Juspay and Easebuzz. It returns `{ ok: true, event }` or `{ ok: false, reason, message }` and never throws.
- Failure reasons: `missing_header`, `bad_signature`, `stale_timestamp`, `malformed_body`, `unsupported_event`, `invalid_options`, `internal_error`.
- A normalised event with `payment` and `refund` details and `amountMinor` as a string of integer paise.
- Per-gateway subpath exports: `india-webhooks/razorpay`, `/cashfree`, `/phonepe`, `/payu`, `/juspay`, `/easebuzz`.
- Test kit at `india-webhooks/testing`: `signWebhook` and `scenarios` (original, duplicate, out-of-order, late, tampered and stale deliveries).
- `docs/SOURCES.md` with the official source for every signing rule, and `docs/MUTATION_EVIDENCE.md`.

### Not supported

- PhonePe HMAC (`x-phonepe-checksum-*`) and v1 `X-VERIFY` webhooks, PayU refund and dispute webhooks (unsigned JSON), PayU split-payment reverse hashes, Juspay JWT webhooks, and Cashfree Cashgram signatures. See the README for the reasons.

[0.1.0]: https://github.com/mokshupadhyay/india-webhooks/releases/tag/v0.1.0
