import { verifyWebhook } from '../index';
import { verifyCashfreeWebhook } from '../cashfree';
import { signWebhook } from '../testing';
import { cashfreePaymentFailed, cashfreePaymentSuccess, cashfreeRefund } from './fixtures';
import { changeChar, expectOk, expectReason, indexes } from './helpers';

const SECRET = 'cf_test_secret';
const NOW = 1785401067911;

describe('cashfree', () => {
  it('matches the documented algorithm for a fixed vector', async () => {
    // base64(HMAC-SHA256("1617695238078" + body, secret)), computed independently with
    // `openssl dgst -sha256 -hmac cf_test_secret -binary | base64`.
    const result = await verifyWebhook('cashfree', {
      rawBody: '{"type":"PAYMENT_SUCCESS_WEBHOOK"}',
      secret: SECRET,
      now: 1617695238078,
      headers: {
        'x-webhook-signature': 'TY3tOxBYdk4xb1JA2DTVF37XgHQuQO94pmeBG7RcQ9A=',
        'x-webhook-timestamp': '1617695238078',
      },
    });
    // The signature is valid; the body lacks data.payment, so the mapped event is malformed.
    expectReason(result, 'malformed_body');
  });

  it('round-trips and converts a decimal rupee amount to paise', async () => {
    const request = await signWebhook('cashfree', cashfreePaymentFailed, SECRET, { timestamp: NOW });
    const event = expectOk(await verifyCashfreeWebhook({ ...request, secret: SECRET, now: NOW }));
    expect(event).toMatchObject({
      provider: 'cashfree',
      type: 'payment.failed',
      providerType: 'PAYMENT_FAILED_WEBHOOK',
      occurredAt: '2023-08-01T14:30:12.000Z',
      payment: {
        id: '1504280029',
        orderId: 'CFPay_g47u3888d0k0_tblfm766qc',
        amountMinor: '180',
        currency: 'INR',
        status: 'FAILED',
        method: 'net_banking',
      },
    });
  });

  it('keeps `6.00` in the raw body and reads it as 600 paise', async () => {
    const request = await signWebhook('cashfree', cashfreePaymentSuccess, SECRET, {
      timestamp: NOW,
      idempotencyKey: 'idem-1',
    });
    expect(request.rawBody).toContain('"payment_amount":6.00');
    const event = expectOk(await verifyWebhook('cashfree', { ...request, secret: SECRET, now: NOW }));
    expect(event.id).toBe('idem-1');
    expect(event.type).toBe('payment.captured');
    expect(event.payment && event.payment.amountMinor).toBe('600');
    expect(event.payment && event.payment.id).toBe('5979305158');
  });

  it('normalises a successful refund', async () => {
    const request = await signWebhook('cashfree', cashfreeRefund, SECRET, { timestamp: NOW });
    const event = expectOk(await verifyWebhook('cashfree', { ...request, secret: SECRET, now: NOW }));
    expect(event.type).toBe('refund.processed');
    expect(event.refund).toEqual({
      id: '11325632',
      paymentId: '789727431',
      orderId: 'sampleorder0413',
      amountMinor: '200',
      currency: 'INR',
      status: 'SUCCESS',
    });
  });

  it('leaves refunds with other statuses and unmapped events as unknown', async () => {
    const cancelled = cashfreeRefund.replace('"refund_status":"SUCCESS"', '"refund_status":"CANCELLED"');
    const request = await signWebhook('cashfree', cancelled, SECRET, { timestamp: NOW });
    const event = expectOk(await verifyWebhook('cashfree', { ...request, secret: SECRET, now: NOW }));
    expect(event.type).toBe('unknown');
    expect(event.refund).toBeUndefined();
    expect(event.raw).toEqual(JSON.parse(cancelled));

    const charges = await signWebhook('cashfree', { type: 'PAYMENT_CHARGES_WEBHOOK', data: {} }, SECRET, { timestamp: NOW });
    expect(expectOk(await verifyWebhook('cashfree', { ...charges, secret: SECRET, now: NOW })).type).toBe('unknown');
  });

  it('fails on any one-character change to the body', async () => {
    const request = await signWebhook('cashfree', cashfreePaymentFailed, SECRET, { timestamp: NOW });
    for (const i of indexes(request.rawBody)) {
      const rawBody = changeChar(request.rawBody, i);
      expectReason(await verifyWebhook('cashfree', { ...request, rawBody, secret: SECRET, now: NOW }), 'bad_signature');
    }
  });

  it('fails on any one-character change to the signature or the timestamp header', async () => {
    const request = await signWebhook('cashfree', cashfreePaymentFailed, SECRET, { timestamp: NOW });
    for (const name of ['x-webhook-signature', 'x-webhook-timestamp']) {
      const value = request.headers[name];
      for (const i of indexes(value)) {
        const headers = { ...request.headers, [name]: changeChar(value, i) };
        expectReason(await verifyWebhook('cashfree', { ...request, headers, secret: SECRET, now: NOW }), 'bad_signature');
      }
    }
  });

  it('fails with the wrong secret or a missing header', async () => {
    const request = await signWebhook('cashfree', cashfreePaymentFailed, SECRET, { timestamp: NOW });
    expectReason(await verifyWebhook('cashfree', { ...request, secret: 'other', now: NOW }), 'bad_signature');
    for (const name of ['x-webhook-signature', 'x-webhook-timestamp']) {
      const headers = { ...request.headers };
      delete headers[name];
      expectReason(await verifyWebhook('cashfree', { ...request, headers, secret: SECRET, now: NOW }), 'missing_header');
    }
  });

  it('rejects stale and future timestamps outside the tolerance', async () => {
    const request = await signWebhook('cashfree', cashfreePaymentFailed, SECRET, { timestamp: NOW });
    const at = (offsetMs: number, toleranceSeconds?: number) =>
      verifyWebhook('cashfree', { ...request, secret: SECRET, now: NOW + offsetMs, toleranceSeconds });
    expectOk(await at(300_000));
    expectOk(await at(-300_000));
    expectReason(await at(300_001), 'stale_timestamp');
    expectReason(await at(-300_001), 'stale_timestamp');
    expectOk(await at(3_600_000, 3600));
    expectReason(await at(1, 0), 'stale_timestamp');
  });

  it('accepts `now` as a Date and rejects invalid tolerance', async () => {
    const request = await signWebhook('cashfree', cashfreePaymentFailed, SECRET, { timestamp: NOW });
    expectOk(await verifyWebhook('cashfree', { ...request, secret: SECRET, now: new Date(NOW) }));
    expectReason(
      await verifyWebhook('cashfree', { ...request, secret: SECRET, now: NOW, toleranceSeconds: -1 }),
      'invalid_options',
    );
  });

  it('treats a signed non-numeric timestamp as stale', async () => {
    const request = await signWebhook('cashfree', cashfreePaymentFailed, SECRET, { timestamp: NOW });
    // Re-sign with a timestamp header that is not a number.
    const { cashfreeSignature } = await import('../providers/cashfree');
    const { utf8 } = await import('../core/bytes');
    const headers = {
      'x-webhook-timestamp': 'yesterday',
      'x-webhook-signature': await cashfreeSignature('yesterday', utf8(request.rawBody), SECRET),
    };
    expectReason(await verifyWebhook('cashfree', { rawBody: request.rawBody, headers, secret: SECRET, now: NOW }), 'stale_timestamp');
  });
});
