import { utf8 } from '../core/bytes';
import { verifyWebhook } from '../index';
import { verifyRazorpayWebhook } from '../razorpay';
import { signWebhook } from '../testing';
import { razorpayPaymentCaptured, razorpayRefundProcessed } from './fixtures';
import { changeChar, expectOk, expectReason, indexes } from './helpers';

const SECRET = 'whsec_razorpay_test';

describe('razorpay', () => {
  it('accepts the official SDK test vector', async () => {
    // razorpay-node test/utils/razorpay-utils.spec.js
    const result = await verifyWebhook('razorpay', {
      rawBody: '{"a":1,"b":2,"c":{"d":3}}',
      secret: '123456',
      headers: { 'X-Razorpay-Signature': '2fe04e22977002e6c7cb553adab8b460cb9e2a4970d5953cb27a8472752e3bbc' },
    });
    const event = expectOk(result);
    expect(event.type).toBe('unknown');
    expect(event.raw).toEqual({ a: 1, b: 2, c: { d: 3 } });
  });

  it('rejects the SDK vector with the SDK test wrong signature', async () => {
    const result = await verifyWebhook('razorpay', {
      rawBody: '{"a":1,"b":2,"c":{"d":3}}',
      secret: '123456',
      headers: { 'x-razorpay-signature': 'sdfafds' },
    });
    expectReason(result, 'bad_signature');
  });

  it('round-trips signWebhook and normalises payment.captured', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, SECRET, { eventId: 'evt_123' });
    expect(request.rawBody).toBe(razorpayPaymentCaptured);
    const event = expectOk(await verifyRazorpayWebhook({ ...request, secret: SECRET }));
    expect(event).toMatchObject({
      provider: 'razorpay',
      type: 'payment.captured',
      id: 'payment.captured:pay_DESlfW9H8K9uqM:1567674606',
      deliveryId: 'evt_123',
      providerType: 'payment.captured',
      occurredAt: '2019-09-05T09:10:06.000Z',
      payment: {
        id: 'pay_DESlfW9H8K9uqM',
        orderId: 'order_DESlLckIVRkHWj',
        amountMinor: '100',
        currency: 'INR',
        status: 'captured',
        method: 'netbanking',
      },
    });
  });

  it('normalises refund.processed with its payment', async () => {
    const request = await signWebhook('razorpay', razorpayRefundProcessed, SECRET);
    const event = expectOk(await verifyWebhook('razorpay', { ...request, secret: SECRET }));
    expect(event.type).toBe('refund.processed');
    expect(event.refund).toEqual({
      id: 'rfnd_FS8TWyPrCsa0OB',
      paymentId: 'pay_FPoJKWQQ8lK13n',
      orderId: 'order_FPoIeimWki9j8A',
      amountMinor: '50000',
      currency: 'INR',
      status: 'processed',
    });
    expect(event.payment && event.payment.amountMinor).toBe('500000');
  });

  it('accepts the body as a Uint8Array', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, SECRET);
    const bytes = utf8(request.rawBody);
    expectOk(await verifyWebhook('razorpay', { rawBody: bytes, headers: request.headers, secret: SECRET }));
  });

  it('fails on any one-character change to the body', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, SECRET);
    for (const i of indexes(request.rawBody)) {
      const result = await verifyWebhook('razorpay', { ...request, rawBody: changeChar(request.rawBody, i), secret: SECRET });
      expectReason(result, 'bad_signature');
    }
  });

  it('fails on any one-character change to the signature', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, SECRET);
    const signature = request.headers['x-razorpay-signature'];
    for (const i of indexes(signature)) {
      const headers = { ...request.headers, 'x-razorpay-signature': changeChar(signature, i) };
      expectReason(await verifyWebhook('razorpay', { ...request, headers, secret: SECRET }), 'bad_signature');
    }
  });

  it('fails with the wrong secret, a missing header, or an empty secret', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, SECRET);
    expectReason(await verifyWebhook('razorpay', { ...request, secret: `${SECRET}x` }), 'bad_signature');
    expectReason(await verifyWebhook('razorpay', { rawBody: request.rawBody, headers: {}, secret: SECRET }), 'missing_header');
    expectReason(await verifyWebhook('razorpay', { ...request, secret: '' }), 'invalid_options');
  });

  it('reports a signed body that is not JSON as malformed', async () => {
    const request = await signWebhook('razorpay', 'not json', SECRET);
    expectReason(await verifyWebhook('razorpay', { ...request, secret: SECRET }), 'malformed_body');
  });

  it('reports a mapped event without its entity as malformed', async () => {
    const request = await signWebhook('razorpay', { event: 'payment.captured', payload: {} }, SECRET);
    expectReason(await verifyWebhook('razorpay', { ...request, secret: SECRET }), 'malformed_body');
  });

  it('reports a fractional amount as malformed', async () => {
    const body = razorpayPaymentCaptured.replace('"amount": 100,', '"amount": 100.5,');
    const request = await signWebhook('razorpay', body, SECRET);
    expectReason(await verifyWebhook('razorpay', { ...request, secret: SECRET }), 'malformed_body');
  });

  it('has no timestamp rule, so `now` does not matter', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, SECRET);
    expectOk(await verifyWebhook('razorpay', { ...request, secret: SECRET, now: 0, toleranceSeconds: 0 }));
  });
});
