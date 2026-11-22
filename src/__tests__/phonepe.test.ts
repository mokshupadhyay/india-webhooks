import { verifyWebhook } from '../index';
import { verifyPhonepeWebhook } from '../phonepe';
import { signWebhook } from '../testing';
import { phonepeOrderCompleted, phonepeRefundCompleted } from './fixtures';
import { changeChar, expectOk, expectReason, indexes } from './helpers';

const CREDENTIALS = { username: 'MERCHANT_USERNAME', password: 'MERCHANT_PASSWORD' };

describe('phonepe', () => {
  it('accepts the official SDK test vectors', async () => {
    // @phonepe-pg/pg-sdk-node tests/callback.test.ts
    const responseBody =
      '{"type":"CHECKOUT_TRANSACTION_ATTEMPT_FAILED","payload":{"orderId":"OMOxx","paymentDetails":[{"paymentMode":"UPI_COLLECT"}]}}';
    const event = expectOk(
      await verifyWebhook('phonepe', {
        rawBody: responseBody,
        credentials: { username: 'username', password: 'password' },
        headers: { Authorization: 'bc842c31a9e54efe320d30d948be61291f3ceee4766e36ab25fa65243cd76e0e' },
      }),
    );
    // PhonePe says to identify events by `event`, which this body lacks.
    expect(event.type).toBe('unknown');

    // tests/utils.test.ts: empty username and password.
    expectOk(
      await verifyWebhook('phonepe', {
        rawBody: '{}',
        credentials: { username: '', password: '' },
        headers: { authorization: 'e7ac0786668e0ff0f02b62bd04f45ff636fd82db63b1104601c975dc005f3a67' },
      }),
    );

    // The SDK test with wrong credentials must fail.
    expectReason(
      await verifyWebhook('phonepe', {
        rawBody: responseBody,
        credentials: { username: 'wrong_username', password: 'password' },
        headers: { authorization: 'bc842c31a9e54efe320d30d948be61291f3ceee4766e36ab25fa65243cd76e0e' },
      }),
      'bad_signature',
    );
  });

  it('round-trips and normalises an order completed event in paisa', async () => {
    const request = await signWebhook('phonepe', phonepeOrderCompleted, CREDENTIALS);
    const event = expectOk(await verifyPhonepeWebhook({ ...request, credentials: CREDENTIALS }));
    expect(event).toMatchObject({
      provider: 'phonepe',
      type: 'payment.captured',
      providerType: 'checkout.order.completed',
      occurredAt: '2024-08-28T17:39:53.837Z',
      payment: {
        id: 'OM12334',
        orderId: 'merchantOrderId',
        amountMinor: '10000',
        currency: 'INR',
        status: 'COMPLETED',
        method: 'UPI_QR',
      },
    });
  });

  it('normalises a refund completed event', async () => {
    const request = await signWebhook('phonepe', phonepeRefundCompleted, CREDENTIALS);
    const event = expectOk(await verifyWebhook('phonepe', { ...request, credentials: CREDENTIALS }));
    expect(event.type).toBe('refund.processed');
    expect(event.refund).toEqual({
      id: 'OMR7878098045517540996',
      paymentId: null,
      orderId: 'Refund-12345',
      amountMinor: '50000',
      currency: 'INR',
      status: 'COMPLETED',
    });
  });

  it('fails on any one-character change to the Authorization header', async () => {
    const request = await signWebhook('phonepe', phonepeOrderCompleted, CREDENTIALS);
    const value = request.headers.authorization;
    for (const i of indexes(value)) {
      const headers = { ...request.headers, authorization: changeChar(value, i) };
      expectReason(await verifyWebhook('phonepe', { ...request, headers, credentials: CREDENTIALS }), 'bad_signature');
    }
  });

  it('fails with the wrong password, a missing header, or missing credentials', async () => {
    const request = await signWebhook('phonepe', phonepeOrderCompleted, CREDENTIALS);
    const wrong = { ...CREDENTIALS, password: 'other' };
    expectReason(await verifyWebhook('phonepe', { ...request, credentials: wrong }), 'bad_signature');
    expectReason(
      await verifyWebhook('phonepe', { rawBody: request.rawBody, headers: {}, credentials: CREDENTIALS }),
      'missing_header',
    );
    expectReason(
      await verifyWebhook('phonepe', { ...request } as unknown as Parameters<typeof verifyPhonepeWebhook>[0]),
      'invalid_options',
    );
  });

  it('does not authenticate the body: a changed body with valid credentials still verifies', async () => {
    // Documented limitation of PhonePe's SHA scheme; see README.
    const request = await signWebhook('phonepe', phonepeOrderCompleted, CREDENTIALS);
    const rawBody = request.rawBody.replace('"amount": 10000', '"amount": 1');
    const event = expectOk(await verifyWebhook('phonepe', { ...request, rawBody, credentials: CREDENTIALS }));
    expect(event.payment && event.payment.amountMinor).toBe('1');
  });

  it('reports an invalid paisa amount as malformed', async () => {
    const body = phonepeOrderCompleted.replace('"amount": 10000,', '"amount": "100.00",');
    const request = await signWebhook('phonepe', body, CREDENTIALS);
    expectReason(await verifyWebhook('phonepe', { ...request, credentials: CREDENTIALS }), 'malformed_body');
  });
});
