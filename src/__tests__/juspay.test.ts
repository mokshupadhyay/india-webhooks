import { verifyWebhook } from '../index';
import { verifyJuspayWebhook } from '../juspay';
import { signWebhook } from '../testing';
import { juspayOrderRefunded, juspayOrderSucceeded } from './fixtures';
import { changeChar, expectOk, expectReason, indexes } from './helpers';

const CREDENTIALS = { username: 'merchantuser', password: 'p@ss:w0rd' };

describe('juspay', () => {
  it('sends and accepts Basic base64(username:password)', async () => {
    const request = await signWebhook('juspay', juspayOrderSucceeded, CREDENTIALS);
    // base64("merchantuser:p@ss:w0rd")
    expect(request.headers.authorization).toBe('Basic bWVyY2hhbnR1c2VyOnBAc3M6dzByZA==');
    const event = expectOk(await verifyJuspayWebhook({ ...request, credentials: CREDENTIALS }));
    expect(event).toMatchObject({
      provider: 'juspay',
      type: 'payment.captured',
      id: 'evt_V2_b737837102414514ae0e9717a9f2664d',
      occurredAt: '2023-08-10T07:00:48.000Z',
      providerType: 'ORDER_SUCCEEDED',
      payment: {
        id: 'moziqFZtYKQkTsRFGXX',
        orderId: 'sample_ord_200',
        amountMinor: '100',
        currency: 'INR',
        status: 'CHARGED',
        method: 'CARD',
      },
    });
  });

  it('accepts any case of the Basic scheme name', async () => {
    const request = await signWebhook('juspay', juspayOrderSucceeded, CREDENTIALS);
    const headers = { Authorization: request.headers.authorization.replace('Basic', 'basic') };
    expectOk(await verifyWebhook('juspay', { rawBody: request.rawBody, headers, credentials: CREDENTIALS }));
  });

  it('normalises ORDER_REFUNDED with the refund amount in paise', async () => {
    const request = await signWebhook('juspay', juspayOrderRefunded, CREDENTIALS);
    const event = expectOk(await verifyWebhook('juspay', { ...request, credentials: CREDENTIALS }));
    expect(event.type).toBe('refund.processed');
    expect(event.payment && event.payment.amountMinor).toBe('800');
    expect(event.refund).toEqual({
      id: 'erf_b0c764a743c4221b',
      paymentId: 'moz3AaBzkvLbgPY99xi',
      orderId: 'sample_ord_403',
      amountMinor: '500',
      currency: 'INR',
      status: 'SUCCESS',
    });
  });

  it('fails on any one-character change to the Authorization header', async () => {
    const request = await signWebhook('juspay', juspayOrderSucceeded, CREDENTIALS);
    const value = request.headers.authorization;
    // Skip the scheme name, which is case-insensitive, and the space.
    for (const i of indexes(value).slice('Basic '.length)) {
      const headers = { ...request.headers, authorization: changeChar(value, i) };
      expectReason(await verifyWebhook('juspay', { ...request, headers, credentials: CREDENTIALS }), 'bad_signature');
    }
  });

  it('fails with the wrong password, a missing header, or a non-Basic header', async () => {
    const request = await signWebhook('juspay', juspayOrderSucceeded, CREDENTIALS);
    expectReason(
      await verifyWebhook('juspay', { ...request, credentials: { ...CREDENTIALS, password: 'nope' } }),
      'bad_signature',
    );
    expectReason(await verifyWebhook('juspay', { rawBody: request.rawBody, credentials: CREDENTIALS }), 'missing_header');
    const bearer = { authorization: 'Bearer bWVyY2hhbnR1c2VyOnBAc3M6dzByZA==' };
    expectReason(await verifyWebhook('juspay', { ...request, headers: bearer, credentials: CREDENTIALS }), 'bad_signature');
  });

  it('reports JWT-encrypted webhooks as unsupported', async () => {
    const request = await signWebhook('juspay', { JWT: 'eyJhbGciOi.x.y' }, CREDENTIALS);
    expectReason(await verifyWebhook('juspay', { ...request, credentials: CREDENTIALS }), 'unsupported_event');
  });

  it('keeps unmapped events as unknown with raw intact', async () => {
    const body = { id: 'evt_1', event_name: 'TXN_CREATED', content: { txn: { id: 't1' } } };
    const request = await signWebhook('juspay', body, CREDENTIALS);
    const event = expectOk(await verifyWebhook('juspay', { ...request, credentials: CREDENTIALS }));
    expect(event.type).toBe('unknown');
    expect(event.raw).toEqual(body);
  });
});
