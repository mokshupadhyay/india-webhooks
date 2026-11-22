/** Gateways this package can verify. */
export type Provider = 'razorpay' | 'cashfree' | 'phonepe' | 'payu' | 'juspay' | 'easebuzz';

export const PROVIDERS: readonly Provider[] = ['razorpay', 'cashfree', 'phonepe', 'payu', 'juspay', 'easebuzz'];

/**
 * The exact request body bytes, as received: a string (encoded as UTF-8), an
 * `ArrayBuffer`, or any `ArrayBufferView` such as a `Uint8Array` or a Node
 * `Buffer`. Never a parsed object.
 */
export type RawBody = string | Uint8Array | ArrayBuffer | ArrayBufferView;

export type HeaderValue = string | readonly string[] | undefined;

/** Anything with a case-insensitive `get`, such as the Fetch API `Headers`. */
export interface HeadersLike {
  get(name: string): string | null;
}

/** Anything whose `entries()` yields name and value pairs, such as a `Map` or Fetch `Headers`. */
export interface HeaderEntries {
  entries(): Iterable<readonly [string, HeaderValue]>;
}

/** Anything with a `Map`-style `forEach(value, name)`. */
export interface HeaderForEach {
  forEach(callback: (value: HeaderValue, name: string) => void): void;
}

/**
 * Fetch `Headers`, a `Map`, any object with `entries()` or `forEach`, or a
 * plain object such as Node's `req.headers`. Names are matched
 * case-insensitively in every case.
 */
export type HeadersInput = HeadersLike | HeaderEntries | HeaderForEach | Readonly<Record<string, HeaderValue>>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export interface JsonObject {
  [key: string]: JsonValue;
}

/** Username and password configured for the webhook in the gateway dashboard. */
export interface Credentials {
  username: string;
  password: string;
}

export interface BaseVerifyOptions {
  /** The exact request body. Read it before any body parser runs. */
  rawBody: RawBody;
  headers?: HeadersInput;
  /** Current time, for schemes with a signed timestamp. Defaults to `Date.now()`. */
  now?: Date | number;
  /** Allowed clock difference for schemes with a signed timestamp. Ignored by the others. */
  toleranceSeconds?: number;
}

export interface SecretVerifyOptions extends BaseVerifyOptions {
  /** Razorpay webhook secret, Cashfree client secret, or PayU / Easebuzz merchant salt. */
  secret: string;
}

export interface CredentialsVerifyOptions extends BaseVerifyOptions {
  credentials: Credentials;
}

export interface VerifyOptionsMap {
  razorpay: SecretVerifyOptions;
  cashfree: SecretVerifyOptions;
  phonepe: CredentialsVerifyOptions;
  payu: SecretVerifyOptions;
  juspay: CredentialsVerifyOptions;
  easebuzz: SecretVerifyOptions;
}

/**
 * Why a delivery was rejected. These strings are stable across releases.
 *
 * - `missing_header`: a required header, or the `hash` field of a form-encoded body, is absent.
 *   PayU and Easebuzz bodies without a `hash` field, JSON included, get this reason.
 * - `bad_signature`: the signature, hash or credentials do not match.
 * - `stale_timestamp`: the signed timestamp is outside the tolerance, or is not a timestamp.
 * - `malformed_body`: authentication passed, but the body cannot be parsed, a mapped event lacks
 *   its fields, an amount is not exact, or a form field appears more than once.
 * - `unsupported_event`: authentication passed, but the delivery is a kind this package cannot read
 *   (Juspay JWT bodies).
 * - `invalid_options`: the call itself is wrong, for example a missing secret or a parsed body.
 * - `internal_error`: something unexpected failed, such as Web Crypto being unavailable.
 */
export type FailureReason =
  | 'missing_header'
  | 'bad_signature'
  | 'stale_timestamp'
  | 'malformed_body'
  | 'unsupported_event'
  | 'invalid_options'
  | 'internal_error';

export type EventType =
  | 'payment.authorized'
  | 'payment.captured'
  | 'payment.failed'
  | 'payment.pending'
  | 'refund.created'
  | 'refund.processed'
  | 'refund.failed'
  | 'unknown';

export interface PaymentDetails {
  /** The gateway's id for the payment or transaction. */
  id: string | null;
  /** The order id you use to find your order. */
  orderId: string | null;
  /** Integer amount in minor units (paise for INR), as a string. Never a float. */
  amountMinor: string;
  /** ISO 4217 code when the payload carries one or the documented unit implies it. */
  currency: string | null;
  /** The gateway's own status string, unchanged. */
  status: string | null;
  /** The gateway's own payment method string, unchanged. */
  method: string | null;
}

export interface RefundDetails {
  id: string | null;
  paymentId: string | null;
  orderId: string | null;
  /** Integer amount in minor units (paise for INR), as a string. Never a float. */
  amountMinor: string;
  currency: string | null;
  status: string | null;
}

export interface WebhookEvent {
  provider: Provider;
  type: EventType;
  /**
   * Built only from body fields that the gateway's scheme authenticates (see the README table
   * "What each field is based on"). The same for every redelivery of the same body.
   */
  id: string;
  /**
   * The delivery or idempotency id from an unsigned header (`x-razorpay-event-id`, Cashfree's
   * `x-idempotency-key`), or `null`. NOT authenticated: use it for logging, not for de-duplication.
   */
  deliveryId: string | null;
  /** ISO 8601 time of the event when the payload has an unambiguous one, otherwise `null`. */
  occurredAt: string | null;
  /** The gateway's own event name or status, unchanged. */
  providerType: string | null;
  payment?: PaymentDetails;
  refund?: RefundDetails;
  /**
   * PayU and Easebuzz only: every form field that the hash does not cover, such as `unmappedstatus`,
   * `mihpayid` or `mode`. Anyone can change these without breaking the hash. Never decide anything
   * about money from them without checking with the gateway first.
   */
  unverified?: Readonly<Record<string, string>>;
  /** The parsed body: JSON as sent, or form fields as strings. */
  raw: JsonObject;
}

export interface VerifySuccess {
  ok: true;
  event: WebhookEvent;
}

export interface VerifyFailure {
  ok: false;
  reason: FailureReason;
  message: string;
}

export type VerifyResult = VerifySuccess | VerifyFailure;
