// Test kit: builds requests signed exactly the way each gateway signs them,
// using the same scheme code the verifiers use, plus delivery scenarios
// (duplicates, out-of-order, late, tampered and stale) for exercising a
// webhook handler. Meant for tests; unlike the verifiers, these functions
// throw on invalid arguments.

import { encodeForm, parseForm } from './core/body.js';
import { utf8 } from './core/bytes.js';
import type { Credentials, FailureReason, JsonObject, Provider, RawBody } from './core/types.js';
import { CASHFREE_DEFAULT_TOLERANCE_SECONDS, cashfreeSignature } from './providers/cashfree.js';
import { easebuzzHash } from './providers/easebuzz.js';
import type { FormFields } from './providers/form.js';
import { juspayAuthorization } from './providers/juspay.js';
import { payuHash } from './providers/payu.js';
import { phonepeAuthorization } from './providers/phonepe.js';
import { razorpaySignature } from './providers/razorpay.js';

type FormProvider = 'payu' | 'easebuzz';
type CredentialsProvider = 'phonepe' | 'juspay';

/** Form fields for PayU and Easebuzz (without `hash`); a JSON object or exact JSON text for the others. */
export type PayloadFor<P extends Provider> = P extends FormProvider ? Readonly<Record<string, string>> : JsonObject | string;

/** Dashboard credentials for PhonePe and Juspay; the secret or salt string for the others. */
export type SecretFor<P extends Provider> = P extends CredentialsProvider ? Credentials : string;

export interface SignOptions {
  /** Cashfree: signing time in milliseconds. Defaults to `Date.now()`. */
  timestamp?: number;
  /** Razorpay: value for `x-razorpay-event-id`. Defaults to an id derived from the signature. */
  eventId?: string;
  /** Cashfree: value for `x-idempotency-key`. Omitted unless given. */
  idempotencyKey?: string;
  /** Cashfree: value for `x-webhook-version`. Defaults to `2025-01-01`. */
  webhookVersion?: string;
}

/** A request as the gateway would send it. Pass `headers` and `rawBody` straight to `verifyWebhook`. */
export interface SignedRequest {
  headers: Record<string, string>;
  rawBody: string;
}

const jsonText = (payload: JsonObject | string): string =>
  typeof payload === 'string' ? payload : JSON.stringify(payload);

// The same rules as the verifiers, so the kit never signs with a secret they reject.
function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string that is not only whitespace.`);
  }
  return value;
}

function requireCredentials(value: unknown): Credentials {
  const c = value as Credentials;
  if (typeof c !== 'object' || c === null || typeof c.username !== 'string' || typeof c.password !== 'string') {
    throw new TypeError('credentials must be { username: string, password: string }.');
  }
  if (c.username.trim() === '' || c.password.trim() === '') {
    throw new TypeError('credentials.username and credentials.password must be non-empty and not only whitespace.');
  }
  return c;
}

async function signForm(
  fields: FormFields,
  salt: string,
  hash: (fields: FormFields, salt: string) => Promise<string>,
): Promise<SignedRequest> {
  const unsigned: Record<string, string> = {};
  for (const key of Object.keys(fields)) if (key !== 'hash') unsigned[key] = fields[key];
  const encoded = encodeForm(unsigned);
  // Hash the values exactly as a receiver will decode them.
  const { fields: decoded, repeated } = parseForm(utf8(encoded));
  if (repeated.size > 0) {
    // For example two names that differ only in lone surrogates, which both decode to U+FFFD.
    throw new TypeError(`Field names decode to the same name: ${Array.from(repeated).join(', ')}. Verifiers reject repeated fields.`);
  }
  const signature = await hash(decoded, salt);
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    rawBody: `${encoded}${encoded === '' ? '' : '&'}${encodeForm({ hash: signature })}`,
  };
}

/** Builds a correctly signed request for `payload`, using the gateway's documented scheme. */
export async function signWebhook<P extends Provider>(
  provider: P,
  payload: PayloadFor<P>,
  secret: SecretFor<P>,
  options: SignOptions = {},
): Promise<SignedRequest> {
  switch (provider as Provider) {
    case 'razorpay': {
      const rawBody = jsonText(payload as JsonObject | string);
      const signature = await razorpaySignature(utf8(rawBody), requireString(secret, 'secret'));
      return {
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': options.eventId || `evt_${signature.slice(0, 14)}`,
        },
        rawBody,
      };
    }
    case 'cashfree': {
      const rawBody = jsonText(payload as JsonObject | string);
      const timestamp = String(options.timestamp === undefined ? Date.now() : Math.trunc(options.timestamp));
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-webhook-signature': await cashfreeSignature(timestamp, utf8(rawBody), requireString(secret, 'secret')),
        'x-webhook-timestamp': timestamp,
        'x-webhook-version': options.webhookVersion || '2025-01-01',
        'x-webhook-attempt': '1',
      };
      if (options.idempotencyKey) headers['x-idempotency-key'] = options.idempotencyKey;
      return { headers, rawBody };
    }
    case 'phonepe':
      return {
        headers: {
          'content-type': 'application/json',
          authorization: await phonepeAuthorization(requireCredentials(secret)),
        },
        rawBody: jsonText(payload as JsonObject | string),
      };
    case 'juspay':
      return {
        headers: {
          'content-type': 'application/json',
          authorization: juspayAuthorization(requireCredentials(secret)),
        },
        rawBody: jsonText(payload as JsonObject | string),
      };
    case 'payu':
      return signForm(payload as FormFields, requireString(secret, 'secret'), payuHash);
    case 'easebuzz':
      return signForm(payload as FormFields, requireString(secret, 'secret'), easebuzzHash);
    default:
      throw new TypeError(`Unknown provider: ${String(provider)}.`);
  }
}

export type DeliveryKind = 'original' | 'duplicate' | 'out_of_order' | 'late' | 'tampered' | 'stale';

export interface Delivery {
  kind: DeliveryKind;
  /** Index into the `events` array this delivery carries. */
  eventIndex: number;
  headers: Record<string, string>;
  rawBody: RawBody;
  /** What `verifyWebhook` returns for it: `'ok'`, or the failure reason. */
  expected: 'ok' | FailureReason;
  description: string;
}

export interface ScenarioOptions extends Omit<SignOptions, 'timestamp'> {
  /** The time the handler will verify at, in milliseconds. Defaults to `Date.now()`. */
  now?: number;
  /** The tolerance the handler verifies with. Defaults to Cashfree's 300 seconds. */
  toleranceSeconds?: number;
  /** How old the late delivery's signature is, in seconds. Defaults to 80% of the tolerance. */
  lateBySeconds?: number;
}

/** Changes one character so the value differs: digits and letters step to the next one. */
function shiftChar(c: string): string {
  if (c >= '0' && c <= '8') return String.fromCharCode(c.charCodeAt(0) + 1);
  if (c === '9') return '0';
  if ((c >= 'a' && c < 'z') || (c >= 'A' && c < 'Z')) return String.fromCharCode(c.charCodeAt(0) + 1);
  if (c === 'z') return 'a';
  if (c === 'Z') return 'A';
  return c === 'x' ? 'y' : 'x';
}

const shiftLast = (text: string): string => text.slice(0, -1) + shiftChar(text.slice(-1));

function tamper(provider: Provider, request: SignedRequest): { headers: Record<string, string>; rawBody: string; what: string } {
  if (provider === 'phonepe' || provider === 'juspay') {
    // The body is not authenticated by these schemes, so tamper with the credentials header.
    return {
      headers: { ...request.headers, authorization: shiftLast(request.headers.authorization) },
      rawBody: request.rawBody,
      what: 'the Authorization header has one character changed',
    };
  }
  if (provider === 'payu' || provider === 'easebuzz') {
    const { fields } = parseForm(utf8(request.rawBody));
    const name = ['amount', 'txnid', 'status', 'key'].find((key) => fields[key]) || 'hash';
    fields[name] = shiftLast(fields[name] || '0');
    return { headers: request.headers, rawBody: encodeForm(fields), what: `the ${name} field has one character changed` };
  }
  const body = request.rawBody;
  const index = body.search(/\d/);
  const at = index >= 0 ? index : body.length - 1;
  return {
    headers: request.headers,
    rawBody: body.slice(0, at) + shiftChar(body.charAt(at)) + body.slice(at + 1),
    what: `byte ${at} of the body is changed`,
  };
}

/**
 * Builds the deliveries a webhook handler should cope with, in this order:
 * each event once (`original`), each again byte for byte (`duplicate`), all of
 * them in reverse order (`out_of_order`, when there are two or more), the first
 * event redelivered after the others with an older but valid signature
 * (`late`), the first event with one byte changed (`tampered`), and for
 * Cashfree, whose signature covers a timestamp, the first event signed outside
 * the tolerance (`stale`).
 */
export async function scenarios<P extends Provider>(
  provider: P,
  events: readonly PayloadFor<P>[],
  secret: SecretFor<P>,
  options: ScenarioOptions = {},
): Promise<Delivery[]> {
  if (events.length === 0) throw new TypeError('scenarios needs at least one event.');
  const now = options.now === undefined ? Date.now() : options.now;
  const tolerance = options.toleranceSeconds === undefined ? CASHFREE_DEFAULT_TOLERANCE_SECONDS : options.toleranceSeconds;
  const lateBy = options.lateBySeconds === undefined ? Math.floor(tolerance * 0.8) : options.lateBySeconds;
  const sign = (payload: PayloadFor<P>, timestamp: number) => signWebhook(provider, payload, secret, { ...options, timestamp });

  const signed: SignedRequest[] = [];
  for (const payload of events) signed.push(await sign(payload, now));

  const deliveries: Delivery[] = [];
  const add = (kind: DeliveryKind, eventIndex: number, request: SignedRequest, expected: Delivery['expected'], description: string) =>
    deliveries.push({ kind, eventIndex, headers: request.headers, rawBody: request.rawBody, expected, description });

  signed.forEach((request, i) => add('original', i, request, 'ok', `event ${i}, first delivery`));
  signed.forEach((request, i) => add('duplicate', i, request, 'ok', `event ${i} again, byte for byte`));
  if (signed.length > 1) {
    for (let i = signed.length - 1; i >= 0; i--) {
      add('out_of_order', i, signed[i], 'ok', `event ${i}, delivered in reverse order`);
    }
  }

  const late = provider === 'cashfree' ? await sign(events[0], now - lateBy * 1000) : signed[0];
  add(
    'late',
    0,
    late,
    'ok',
    provider === 'cashfree'
      ? `event 0 redelivered after newer events, signed ${lateBy}s ago (inside the ${tolerance}s tolerance)`
      : 'event 0 redelivered after newer events',
  );

  const tampered = tamper(provider, signed[0]);
  add('tampered', 0, tampered, 'bad_signature', `event 0, but ${tampered.what}`);

  if (provider === 'cashfree') {
    const staleBy = tolerance + 60;
    add('stale', 0, await sign(events[0], now - staleBy * 1000), 'stale_timestamp', `event 0 signed ${staleBy}s ago`);
  }
  return deliveries;
}

export type { Credentials, FailureReason, JsonObject, Provider, RawBody } from './core/types.js';
