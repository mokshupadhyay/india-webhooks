import fc from 'fast-check';
import { encodeForm, parseForm } from '../core/body';
import { utf8 } from '../core/bytes';
import { PROVIDERS, verifyWebhook } from '../index';
import type { Credentials, FailureReason, JsonObject, VerifyOptionsMap, VerifyResult } from '../index';
import { signWebhook } from '../testing';

const NOW = 1785401067911;
const RUNS = { numRuns: 150 };

// Arbitrary text including astral characters and, through `binary`, lone surrogates.
const text = fc.oneof(fc.string(), fc.string({ unit: 'binary' }), fc.string({ unit: 'grapheme' }));
// Blank secrets and credentials are rejected as invalid_options, so they are not generated here.
const nonBlank = text.filter((s) => s.trim().length > 0);
const secret = nonBlank;
const credentials: fc.Arbitrary<Credentials> = fc.record({ username: nonBlank, password: nonBlank });
const jsonPayload = fc.dictionary(text, fc.jsonValue({ maxDepth: 3 }), { maxKeys: 6 }) as fc.Arbitrary<JsonObject>;

const HASHED = ['status', 'udf1', 'udf2', 'udf3', 'udf4', 'udf5', 'email', 'firstname', 'productinfo', 'txnid', 'key'];
// Integers below 2^53 are exact, so plain number arithmetic is safe here.
const paise = fc.integer({ min: 0, max: 10 ** 12 });
const rupees = (p: number): string => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;
const rupeeString = paise.map(rupees);
const formPayload = fc
  .record({
    status: fc.oneof(fc.constantFrom('success', 'failure', 'pending', 'usercancelled'), text),
    amount: rupeeString,
    extra: fc.dictionary(fc.oneof(fc.constantFrom(...HASHED, 'udf10', 'mihpayid', 'easepayid'), text), text, { maxKeys: 8 }),
  })
  .map(({ status, amount, extra }) => {
    const fields: Record<string, string> = { ...extra, status, amount };
    delete fields.hash;
    return fields;
  })
  // Names with lone surrogates can decode to the same name, which verifiers reject as repeated.
  .filter((fields) => parseForm(utf8(encodeForm(fields))).repeated.size === 0);

const ok = (result: VerifyResult) => {
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
  return result.event;
};

/** Flips bits of one byte, so the body always changes. */
const oneByteChange = fc.record({ position: fc.nat(), xor: fc.integer({ min: 1, max: 255 }) });
function changeByte(bytes: Uint8Array, change: { position: number; xor: number }): Uint8Array {
  const copy = bytes.slice();
  const i = change.position % copy.length;
  copy[i] ^= change.xor;
  return copy;
}

describe('property 1: verifying a signWebhook result is ok, for any payload and secret', () => {
  it('razorpay', () =>
    fc.assert(
      fc.asyncProperty(jsonPayload, secret, async (payload, s) => {
        const request = await signWebhook('razorpay', payload, s);
        ok(await verifyWebhook('razorpay', { ...request, secret: s }));
      }),
      RUNS,
    ));

  it('cashfree', () =>
    fc.assert(
      fc.asyncProperty(jsonPayload, secret, fc.integer({ min: 0, max: 4e12 }), async (payload, s, timestamp) => {
        const request = await signWebhook('cashfree', payload, s, { timestamp });
        ok(await verifyWebhook('cashfree', { ...request, secret: s, now: timestamp }));
      }),
      RUNS,
    ));

  it('phonepe', () =>
    fc.assert(
      fc.asyncProperty(jsonPayload, credentials, async (payload, c) => {
        const request = await signWebhook('phonepe', payload, c);
        ok(await verifyWebhook('phonepe', { ...request, credentials: c }));
      }),
      RUNS,
    ));

  it('juspay', () =>
    fc.assert(
      fc.asyncProperty(jsonPayload, credentials, async (payload, c) => {
        const request = await signWebhook('juspay', payload, c);
        ok(await verifyWebhook('juspay', { ...request, credentials: c }));
      }),
      RUNS,
    ));

  it('payu', () =>
    fc.assert(
      fc.asyncProperty(formPayload, secret, async (payload, s) => {
        const request = await signWebhook('payu', payload, s);
        ok(await verifyWebhook('payu', { ...request, secret: s }));
      }),
      RUNS,
    ));

  it('easebuzz', () =>
    fc.assert(
      fc.asyncProperty(formPayload, secret, async (payload, s) => {
        const request = await signWebhook('easebuzz', payload, s);
        ok(await verifyWebhook('easebuzz', { ...request, secret: s }));
      }),
      RUNS,
    ));
});

describe('property 2: any single-byte change to the raw body makes verification fail', () => {
  // Holds for the schemes that sign the raw body bytes.
  it('razorpay', () =>
    fc.assert(
      fc.asyncProperty(jsonPayload, secret, oneByteChange, async (payload, s, change) => {
        const request = await signWebhook('razorpay', payload, s);
        const rawBody = changeByte(utf8(request.rawBody), change);
        const result = await verifyWebhook('razorpay', { rawBody, headers: request.headers, secret: s });
        expect(result.ok ? 'ok' : result.reason).toBe('bad_signature');
      }),
      RUNS,
    ));

  it('cashfree', () =>
    fc.assert(
      fc.asyncProperty(jsonPayload, secret, oneByteChange, async (payload, s, change) => {
        const request = await signWebhook('cashfree', payload, s, { timestamp: NOW });
        const rawBody = changeByte(utf8(request.rawBody), change);
        const result = await verifyWebhook('cashfree', { rawBody, headers: request.headers, secret: s, now: NOW });
        expect(result.ok ? 'ok' : result.reason).toBe('bad_signature');
      }),
      RUNS,
    ));

  // PayU and Easebuzz hash decoded field values, not bytes, so the byte-level
  // property does not hold for fields outside the hash. What holds is the
  // field-level version: any one-character change to a hashed value fails.
  for (const provider of ['payu', 'easebuzz'] as const) {
    it(`${provider} (field level: any change to one hashed value)`, () =>
      fc.assert(
        fc.asyncProperty(
          formPayload,
          secret,
          fc.constantFrom('status', 'amount', 'txnid', 'key', 'email', 'firstname', 'productinfo', 'udf1', 'udf5'),
          fc.nat(),
          fc.constantFrom('0', 'x', '|', ' ', '\u00e9'),
          async (payload, s, name, position, insert) => {
            const request = await signWebhook(provider, payload, s);
            const fields = parseForm(utf8(request.rawBody)).fields;
            const value = fields[name] || '';
            const at = value.length === 0 ? 0 : position % value.length;
            const changed = value.slice(0, at) + insert + value.slice(at);
            const rawBody = encodeForm({ ...fields, [name]: changed });
            const result = await verifyWebhook(provider, { rawBody, secret: s });
            expect(result.ok ? 'ok' : result.reason).toBe('bad_signature');
          },
        ),
        RUNS,
      ));
  }
});

describe('property 3: amountMinor is an integer string that round-trips the documented unit', () => {
  const INTEGER = /^(0|[1-9]\d*)$/;

  it('razorpay and phonepe send integer paise', () =>
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), async (amount) => {
        const rp = await signWebhook(
          'razorpay',
          { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', amount, currency: 'INR' } } } },
          's',
        );
        const pp = await signWebhook('phonepe', { event: 'checkout.order.completed', payload: { amount } }, { username: 'u', password: 'p' });
        for (const minor of [
          ok(await verifyWebhook('razorpay', { ...rp, secret: 's' })).payment?.amountMinor,
          ok(await verifyWebhook('phonepe', { ...pp, credentials: { username: 'u', password: 'p' } })).payment?.amountMinor,
        ]) {
          expect(minor).toMatch(INTEGER);
          expect(Number(minor)).toBe(amount);
        }
      }),
      RUNS,
    ));

  it('cashfree and juspay send rupees as JSON numbers', () =>
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 10 ** 12 }), async (minorUnits) => {
        const major = minorUnits / 100;
        const cf = await signWebhook(
          'cashfree',
          { type: 'PAYMENT_SUCCESS_WEBHOOK', data: { payment: { payment_amount: major } } },
          's',
          { timestamp: NOW },
        );
        const jp = await signWebhook(
          'juspay',
          { event_name: 'ORDER_SUCCEEDED', content: { order: { amount: major } } },
          { username: 'u', password: 'p' },
        );
        for (const minor of [
          ok(await verifyWebhook('cashfree', { ...cf, secret: 's', now: NOW })).payment?.amountMinor,
          ok(await verifyWebhook('juspay', { ...jp, credentials: { username: 'u', password: 'p' } })).payment?.amountMinor,
        ]) {
          expect(minor).toMatch(INTEGER);
          expect(minor).toBe(String(minorUnits));
          expect(Number(minor) / 100).toBe(major);
        }
      }),
      RUNS,
    ));

  it('payu and easebuzz send rupees as decimal strings', () =>
    fc.assert(
      fc.asyncProperty(paise, fc.constantFrom(0, 1, 2), async (p, decimals) => {
        const whole = Math.floor(p / 100);
        const fraction = String(p % 100).padStart(2, '0');
        // Drop trailing fraction digits only when they are zero, so the amount stays exact.
        const shown = decimals === 2 || fraction.slice(decimals) === '0'.repeat(2 - decimals) ? decimals : 2;
        const amount = shown === 0 ? String(whole) : `${whole}.${fraction.slice(0, shown)}`;
        for (const provider of ['payu', 'easebuzz'] as const) {
          const request = await signWebhook(provider, { status: 'success', amount, txnid: 't', key: 'k' }, 'salt');
          const minor = ok(await verifyWebhook(provider, { ...request, secret: 'salt' })).payment?.amountMinor;
          expect(minor).toMatch(INTEGER);
          expect(minor).toBe(String(p));
          // Back to the documented unit: the same rupee value the gateway sent.
          expect(rupees(Number(minor))).toBe(`${whole}.${fraction}`);
        }
      }),
      RUNS,
    ));
});

describe('property 4: a request without valid authentication only ever gets missing_header or bad_signature', () => {
  // A handler might acknowledge malformed_body or unsupported_event with a 200,
  // so those reasons must only appear after authentication has passed.
  const AUTH_FAILURES: FailureReason[] = ['missing_header', 'bad_signature'];
  const formFields = fc.dictionary(fc.oneof(fc.constantFrom(...HASHED, 'amount', 'mihpayid'), text), text, { maxKeys: 8 });
  const hexHash = fc.stringMatching(/^[0-9a-f]{128}$/);
  const body = fc.oneof(
    text,
    jsonPayload.map((payload) => JSON.stringify(payload)),
    formFields.map((fields) => encodeForm(fields)),
    fc.tuple(formFields, hexHash, fc.boolean()).map(([fields, hash, repeat]) => {
      const encoded = encodeForm({ ...fields, hash });
      // Sometimes repeat a field, which must still be an authentication failure when the hash is wrong.
      return repeat ? `${encoded}&amount=1.00&amount=2.00` : encoded;
    }),
  );
  const headerNames = fc.constantFrom('x-razorpay-signature', 'x-webhook-signature', 'x-webhook-timestamp', 'authorization', 'x-other');
  const headerValue = fc.oneof(text, fc.base64String().map((b) => `Basic ${b}`), fc.constant(String(NOW)), hexHash);
  const headers = fc.dictionary(headerNames, headerValue);

  for (const provider of PROVIDERS) {
    it(provider, () =>
      fc.assert(
        fc.asyncProperty(body, headers, secret, credentials, async (rawBody, h, s, c) => {
          const options = { rawBody, headers: h, secret: s, credentials: c, now: NOW };
          const result = await verifyWebhook(provider, options as VerifyOptionsMap[typeof provider]);
          expect(AUTH_FAILURES).toContain(result.ok ? 'ok' : result.reason);
        }),
        RUNS,
      ));
  }
});

describe('property 5: verifyWebhook never throws and never rejects, whatever it is given', () => {
  const REASONS: FailureReason[] = [
    'missing_header',
    'bad_signature',
    'stale_timestamp',
    'malformed_body',
    'unsupported_event',
    'invalid_options',
    'internal_error',
  ];
  const anything = fc.anything({
    withBigInt: true,
    withBoxedValues: true,
    withDate: true,
    withMap: true,
    withSet: true,
    withNullPrototype: true,
    withObjectString: true,
    withSparseArray: true,
    withTypedArray: true,
  });
  const provider = fc.oneof(fc.constantFrom(...PROVIDERS), anything);
  const options = fc.oneof(
    anything,
    fc.record(
      { rawBody: anything, headers: anything, secret: anything, credentials: anything, now: anything, toleranceSeconds: anything },
      { requiredKeys: [] },
    ),
  );

  it('for arbitrary provider and options', () =>
    fc.assert(
      fc.asyncProperty(provider, options, async (p, o) => {
        let pending: Promise<VerifyResult>;
        try {
          pending = verifyWebhook(p as 'razorpay', o as VerifyOptionsMap['razorpay']);
        } catch (error) {
          throw new Error(`verifyWebhook threw synchronously: ${String((error as Error).message)}`);
        }
        // A rejection fails the property here.
        const result = await pending;
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(REASONS).toContain(result.reason);
          expect(typeof result.message).toBe('string');
        }
      }),
      { numRuns: 500 },
    ));
});
