/** Gateways this package can verify. */
export type Provider = 'razorpay' | 'cashfree' | 'phonepe' | 'payu' | 'juspay' | 'easebuzz';

export const PROVIDERS: readonly Provider[] = ['razorpay', 'cashfree', 'phonepe', 'payu', 'juspay', 'easebuzz'];

/** The exact request body bytes, as received. Never a parsed object. */
export type RawBody = string | Uint8Array;

export type HeaderValue = string | readonly string[] | undefined;

/** Anything with a case-insensitive `get`, such as the Fetch API `Headers`. */
export interface HeadersLike {
  get(name: string): string | null;
}

/** Fetch `Headers`, or a plain object such as Node's `req.headers`. */
export type HeadersInput = HeadersLike | Readonly<Record<string, HeaderValue>>;

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
 * - `bad_signature`: the signature, hash or credentials do not match.
 * - `stale_timestamp`: the signed timestamp is outside the tolerance, or is not a timestamp.
 * - `malformed_body`: the body is authentic but cannot be parsed, or a mapped event lacks its fields.
 * - `unsupported_event`: the body is a kind of delivery this package cannot verify.
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
  /** The gateway's event or idempotency id when it sends one, otherwise built from signed fields. */
  id: string;
  /** ISO 8601 time of the event when the payload has an unambiguous one, otherwise `null`. */
  occurredAt: string | null;
  /** The gateway's own event name or status, unchanged. */
  providerType: string | null;
  payment?: PaymentDetails;
  refund?: RefundDetails;
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
