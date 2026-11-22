import { PROVIDERS, verifyWebhook } from '../index';
import type { Provider, VerifyOptionsMap } from '../index';
import { scenarios, signWebhook } from '../testing';
import { cashfreePaymentFailed, juspayOrderSucceeded, payuSuccessFields, phonepeOrderCompleted, razorpayPaymentCaptured } from './fixtures';
import { expectOk, expectReason } from './helpers';

const NOW = 1785401067911;

describe('verifyWebhook never throws', () => {
  const junk: unknown[] = [undefined, null, 42, 'string', [], {}, { rawBody: {} }, { rawBody: 'x', secret: 7 }];

  it.each(PROVIDERS)('%s returns a typed failure for junk options', async (provider) => {
    for (const options of junk) {
      const result = await verifyWebhook(provider, options as VerifyOptionsMap[typeof provider]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(['invalid_options', 'missing_header']).toContain(result.reason);
        expect(typeof result.message).toBe('string');
      }
    }
  });

  it('rejects a parsed object passed as rawBody', async () => {
    const result = await verifyWebhook('razorpay', {
      rawBody: JSON.parse(razorpayPaymentCaptured) as unknown as string,
      headers: { 'x-razorpay-signature': 'x' },
      secret: 's',
    });
    expectReason(result, 'invalid_options');
    if (!result.ok) expect(result.message).toMatch(/before any JSON or form parser/);
  });

  it('rejects an unknown provider', async () => {
    const result = await verifyWebhook('stripe' as Provider, { rawBody: '', secret: 's' } as VerifyOptionsMap['razorpay']);
    expectReason(result, 'invalid_options');
  });

  it('accepts a Node Buffer as rawBody', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, 's');
    const NodeBuffer = (globalThis as unknown as { Buffer: { from(text: string): Uint8Array } }).Buffer;
    expectOk(await verifyWebhook('razorpay', { rawBody: NodeBuffer.from(request.rawBody), headers: request.headers, secret: 's' }));
  });

  it('reports a missing Web Crypto as internal_error instead of throwing', async () => {
    jest.resetModules();
    const g = globalThis as unknown as { crypto?: unknown; process?: unknown };
    const savedCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const savedProcess = g.process;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    g.process = undefined;
    try {
      const fresh = await import('../index');
      const result = await fresh.verifyWebhook('razorpay', {
        rawBody: '{}',
        headers: { 'x-razorpay-signature': 'ab' },
        secret: 's',
      });
      expectReason(result, 'internal_error');
    } finally {
      g.process = savedProcess;
      if (savedCrypto) Object.defineProperty(globalThis, 'crypto', savedCrypto);
    }
  });
});

describe('scenarios', () => {
  const cases: [Provider, unknown[], unknown, Record<string, unknown>][] = [
    ['razorpay', [razorpayPaymentCaptured, razorpayPaymentCaptured.replace('payment.captured', 'payment.failed')], 'rk', { secret: 'rk' }],
    ['cashfree', [cashfreePaymentFailed, cashfreePaymentFailed.replace('1.8', '2.5')], 'ck', { secret: 'ck' }],
    ['phonepe', [phonepeOrderCompleted], { username: 'u', password: 'p' }, { credentials: { username: 'u', password: 'p' } }],
    ['juspay', [juspayOrderSucceeded], { username: 'u', password: 'p' }, { credentials: { username: 'u', password: 'p' } }],
    ['payu', [payuSuccessFields, { ...payuSuccessFields, txnid: 'T2', status: 'failure' }], 'salt', { secret: 'salt' }],
    ['easebuzz', [{ key: 'K', txnid: 'T', amount: '1.00', status: 'success' }], 'salt', { secret: 'salt' }],
  ];

  it.each(cases)('%s deliveries verify to their expected result', async (provider, events, secret, auth) => {
    const deliveries = await scenarios(provider, events as never[], secret as never, { now: NOW });
    const kinds = deliveries.map((d) => d.kind);
    expect(kinds).toContain('original');
    expect(kinds).toContain('duplicate');
    expect(kinds).toContain('late');
    expect(kinds).toContain('tampered');
    expect(kinds.includes('out_of_order')).toBe(events.length > 1);
    expect(kinds.includes('stale')).toBe(provider === 'cashfree');

    const ids = new Map<number, string>();
    for (const delivery of deliveries) {
      const result = await verifyWebhook(provider, {
        rawBody: delivery.rawBody,
        headers: delivery.headers,
        now: NOW,
        ...auth,
      } as VerifyOptionsMap[typeof provider]);
      expect(result.ok ? 'ok' : result.reason).toBe(delivery.expected);
      if (result.ok) {
        // Every valid delivery of the same event carries the same id, so handlers can de-duplicate.
        const seen = ids.get(delivery.eventIndex);
        if (seen === undefined) ids.set(delivery.eventIndex, result.event.id);
        else expect(result.event.id).toBe(seen);
      }
    }
  });

  it('orders out_of_order deliveries in reverse', async () => {
    const deliveries = await scenarios('payu', [payuSuccessFields, { ...payuSuccessFields, txnid: 'T2' }], 'salt');
    expect(deliveries.filter((d) => d.kind === 'out_of_order').map((d) => d.eventIndex)).toEqual([1, 0]);
  });

  it('signs the Cashfree late delivery inside, and the stale one outside, the tolerance', async () => {
    const deliveries = await scenarios('cashfree', [cashfreePaymentFailed], 'ck', { now: NOW, toleranceSeconds: 100 });
    const late = deliveries.find((d) => d.kind === 'late');
    const stale = deliveries.find((d) => d.kind === 'stale');
    expect(Number(late && late.headers['x-webhook-timestamp'])).toBe(NOW - 80_000);
    expect(Number(stale && stale.headers['x-webhook-timestamp'])).toBe(NOW - 160_000);
  });

  it('rejects an empty event list', async () => {
    await expect(scenarios('razorpay', [], 's')).rejects.toThrow(TypeError);
  });
});
