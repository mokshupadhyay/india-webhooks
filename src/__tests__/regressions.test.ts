// Regression tests for the review findings fixed before the 0.1.0 release.
// Each `describe` block names the finding it covers (F1 to F9).

import { encodeForm } from '../core/body';
import { toBase64, toHex, utf8 } from '../core/bytes';
import { digest } from '../core/crypto';
import { verifyWebhook } from '../index';
import type { VerifyOptionsMap } from '../index';
import { phonepeAuthorization } from '../providers/phonepe';
import { razorpaySignature } from '../providers/razorpay';
import { signWebhook } from '../testing';
import { cashfreePaymentSuccess, payuSuccessFields, razorpayPaymentCaptured } from './fixtures';
import { expectOk, expectReason } from './helpers';

const NOW = 1785401067911;

describe('F1 empty or blank credentials and secrets are rejected', () => {
  it('phonepe: empty credentials with a forged sha256(":") header give invalid_options', async () => {
    const forged = toHex(await digest('SHA-256', utf8(':')));
    const result = await verifyWebhook('phonepe', {
      rawBody: '{"event":"checkout.order.completed","payload":{"amount":1}}',
      headers: { authorization: forged },
      credentials: { username: '', password: '' },
    });
    expectReason(result, 'invalid_options');
  });

  it('juspay: empty credentials with a forged `Basic Og==` header give invalid_options', async () => {
    const result = await verifyWebhook('juspay', {
      rawBody: '{"event_name":"ORDER_SUCCEEDED","content":{"order":{"amount":1}}}',
      headers: { authorization: 'Basic Og==' },
      credentials: { username: '', password: '' },
    });
    expectReason(result, 'invalid_options');
  });

  it.each([
    ['', 'p'],
    ['u', ''],
    ['   ', 'p'],
    ['u', '\t\n '],
  ])('rejects username %j with password %j for phonepe and juspay', async (username, password) => {
    const credentials = { username, password };
    const phonepe = { authorization: await phonepeAuthorization(credentials) };
    expectReason(await verifyWebhook('phonepe', { rawBody: '{}', headers: phonepe, credentials }), 'invalid_options');
    const juspay = { authorization: `Basic ${toBase64(utf8(`${username}:${password}`))}` };
    expectReason(await verifyWebhook('juspay', { rawBody: '{}', headers: juspay, credentials }), 'invalid_options');
  });

  it('rejects a whitespace-only secret, as for credentials', async () => {
    // Signed directly: the test kit refuses blank secrets.
    const headers = { 'x-razorpay-signature': await razorpaySignature(utf8(razorpayPaymentCaptured), '   ') };
    expectReason(await verifyWebhook('razorpay', { rawBody: razorpayPaymentCaptured, headers, secret: '   ' }), 'invalid_options');
  });

  it('the test kit refuses to sign with empty credentials or a blank secret', async () => {
    await expect(signWebhook('phonepe', {}, { username: '', password: '' })).rejects.toThrow(TypeError);
    await expect(signWebhook('juspay', {}, { username: 'u', password: ' ' })).rejects.toThrow(TypeError);
    await expect(signWebhook('razorpay', {}, '  ')).rejects.toThrow(TypeError);
  });
});

describe('F2 event.id is built only from signed fields; header ids are deliveryId', () => {
  it('razorpay: changing x-razorpay-event-id changes deliveryId but not event.id', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, 's', { eventId: 'evt_A' });
    const a = expectOk(await verifyWebhook('razorpay', { ...request, secret: 's' }));
    const headers = { ...request.headers, 'x-razorpay-event-id': 'evt_B' };
    const b = expectOk(await verifyWebhook('razorpay', { ...request, headers, secret: 's' }));
    expect(a.id).toBe('payment.captured:pay_DESlfW9H8K9uqM:1567674606');
    expect(b.id).toBe(a.id);
    expect(a.deliveryId).toBe('evt_A');
    expect(b.deliveryId).toBe('evt_B');
  });

  it('cashfree: x-idempotency-key is deliveryId; event.id comes from the signed body', async () => {
    const request = await signWebhook('cashfree', cashfreePaymentSuccess, 'k', { timestamp: NOW, idempotencyKey: 'idem-1' });
    const a = expectOk(await verifyWebhook('cashfree', { ...request, secret: 'k', now: NOW }));
    const headers = { ...request.headers, 'x-idempotency-key': 'idem-2' };
    const b = expectOk(await verifyWebhook('cashfree', { ...request, headers, secret: 'k', now: NOW }));
    expect(a.id).toBe('PAYMENT_SUCCESS_WEBHOOK:5979305158:2026-07-15T08:00:05+05:30');
    expect(b.id).toBe(a.id);
    expect(a.deliveryId).toBe('idem-1');
    expect(b.deliveryId).toBe('idem-2');

    const noKey = await signWebhook('cashfree', cashfreePaymentSuccess, 'k', { timestamp: NOW });
    const c = expectOk(await verifyWebhook('cashfree', { ...noKey, secret: 'k', now: NOW }));
    expect(c.id).toBe(a.id);
    expect(c.deliveryId).toBeNull();
  });

  it('payu: changing a field outside the hash does not change event.id; deliveryId is null', async () => {
    const request = await signWebhook('payu', payuSuccessFields, 'salt');
    const a = expectOk(await verifyWebhook('payu', { ...request, secret: 'salt' }));
    const rawBody = request.rawBody.replace('mihpayid=27553369917', 'mihpayid=1');
    const b = expectOk(await verifyWebhook('payu', { rawBody, secret: 'salt' }));
    expect(a.id).toBe('T2603041446091822117753:success');
    expect(b.id).toBe(a.id);
    expect(a.deliveryId).toBeNull();
  });

  it('phonepe, juspay and easebuzz have no delivery header, so deliveryId is null', async () => {
    const c = { username: 'u', password: 'p' };
    const pp = await signWebhook('phonepe', { event: 'x' }, c);
    expect(expectOk(await verifyWebhook('phonepe', { ...pp, credentials: c })).deliveryId).toBeNull();
    const jp = await signWebhook('juspay', { id: 'evt_1', event_name: 'x' }, c);
    expect(expectOk(await verifyWebhook('juspay', { ...jp, credentials: c })).deliveryId).toBeNull();
    const eb = await signWebhook('easebuzz', { status: 'success', amount: '1.00', txnid: 't' }, 'salt');
    expect(expectOk(await verifyWebhook('easebuzz', { ...eb, secret: 'salt' })).deliveryId).toBeNull();
  });
});

describe('F3 PayU and Easebuzz: type only from hashed fields, unverified fields, no repeated fields', () => {
  it('payu: status=success is payment.captured even when unmappedstatus=auth, which is exposed as unverified', async () => {
    const request = await signWebhook('payu', { ...payuSuccessFields, unmappedstatus: 'auth' }, 'salt');
    const event = expectOk(await verifyWebhook('payu', { ...request, secret: 'salt' }));
    expect(event.type).toBe('payment.captured');
    expect(event.unverified).toEqual({
      mihpayid: '27553369917',
      mode: 'SBQR',
      addedon: '2026-03-04 14:46:14',
      unmappedstatus: 'auth',
      bank_ref_num: '793887773815',
    });
  });

  it('payu: prepending a duplicate unmappedstatus is rejected as malformed_body', async () => {
    const request = await signWebhook('payu', { ...payuSuccessFields, unmappedstatus: 'auth' }, 'salt');
    const rawBody = `unmappedstatus=captured&${request.rawBody}`;
    expectReason(await verifyWebhook('payu', { rawBody, secret: 'salt' }), 'malformed_body');
  });

  it('payu: any repeated field is rejected, even with the same value, hashed or not', async () => {
    const request = await signWebhook('payu', payuSuccessFields, 'salt');
    for (const extra of ['mode=SBQR', 'status=success', 'udf9=a&udf9=a']) {
      expectReason(await verifyWebhook('payu', { rawBody: `${request.rawBody}&${extra}`, secret: 'salt' }), 'malformed_body');
    }
    const hash = /(?:^|&)hash=([^&]*)/.exec(request.rawBody)![1];
    expectReason(await verifyWebhook('payu', { rawBody: `${request.rawBody}&hash=${hash}`, secret: 'salt' }), 'malformed_body');
  });

  it('easebuzz: a repeated field outside the hash is rejected, and unverified lists the unhashed fields', async () => {
    const request = await signWebhook('easebuzz', { status: 'success', amount: '1.00', txnid: 't', easepayid: 'E1', mode: 'UPI' }, 'salt');
    const event = expectOk(await verifyWebhook('easebuzz', { ...request, secret: 'salt' }));
    expect(event.unverified).toEqual({ easepayid: 'E1', mode: 'UPI' });
    expectReason(await verifyWebhook('easebuzz', { rawBody: `easepayid=E2&${request.rawBody}`, secret: 'salt' }), 'malformed_body');
  });
});

describe('F4 Juspay refund events pick a refund whose status matches the event', () => {
  const body = (eventName: string, refunds: unknown[]) =>
    JSON.stringify({
      id: 'evt_1',
      event_name: eventName,
      content: { order: { id: 'ordeh_1', order_id: 'o1', amount: 10, currency: 'INR', status: 'CHARGED', refunds } },
    });
  const c = { username: 'u', password: 'p' };
  const verify = async (eventName: string, refunds: unknown[]) =>
    verifyWebhook('juspay', { ...(await signWebhook('juspay', body(eventName, refunds), c)), credentials: c });

  const failedOld = { unique_request_id: 'r_failed', created: '2023-08-10T07:00:00Z', status: 'FAILURE', amount: 2 };
  const successNew = { unique_request_id: 'r_success', created: '2023-08-10T08:00:00Z', status: 'SUCCESS', amount: 3 };
  const successOld = { unique_request_id: 'r_success_old', created: '2023-08-10T06:00:00Z', status: 'SUCCESS', amount: 1 };
  const failedNew = { unique_request_id: 'r_failed_new', created: '2023-08-10T09:00:00Z', status: 'FAILURE', amount: 4 };

  it('ORDER_REFUND_FAILED picks the most recent failed refund, not the newest refund', async () => {
    const event = expectOk(await verify('ORDER_REFUND_FAILED', [failedOld, successNew]));
    expect(event.type).toBe('refund.failed');
    expect(event.refund).toMatchObject({ id: 'r_failed', status: 'FAILURE', amountMinor: '200' });
  });

  it('ORDER_REFUNDED picks the most recent successful refund', async () => {
    const event = expectOk(await verify('ORDER_REFUNDED', [successOld, successNew, failedNew]));
    expect(event.refund).toMatchObject({ id: 'r_success', status: 'SUCCESS', amountMinor: '300' });
  });

  it('a refund event with no matching refund is malformed_body', async () => {
    expectReason(await verify('ORDER_REFUNDED', [failedNew]), 'malformed_body');
    expectReason(await verify('ORDER_REFUND_FAILED', [successNew]), 'malformed_body');
    expectReason(await verify('ORDER_REFUNDED', []), 'malformed_body');
  });
});

describe('F5 Easebuzz statuses are compared lowercased and failed statuses map to payment.failed', () => {
  it.each([
    ['SUCCESS', 'payment.captured'],
    ['Pending', 'payment.pending'],
    ['userCancelled', 'payment.failed'],
    ['failure', 'payment.failed'],
    ['dropped', 'payment.failed'],
    ['bounced', 'payment.failed'],
  ])('status %s is %s', async (status, type) => {
    const request = await signWebhook('easebuzz', { status, amount: '1.00', txnid: 't', key: 'k' }, 'salt');
    const event = expectOk(await verifyWebhook('easebuzz', { ...request, secret: 'salt' }));
    expect(event.type).toBe(type);
    expect(event.payment && event.payment.status).toBe(status);
  });
});

describe('F6 string amounts stay exact at any size', () => {
  it('keeps digit-string amounts above 2^53 exact instead of rejecting them', async () => {
    const big = '9007199254740993123';
    const rp = await signWebhook('razorpay', { event: 'payment.captured', payload: { payment: { entity: { id: 'p', amount: big } } } }, 's');
    expect(expectOk(await verifyWebhook('razorpay', { ...rp, secret: 's' })).payment!.amountMinor).toBe(big);
    const pu = await signWebhook('payu', { status: 'success', amount: '90071992547409931.23', txnid: 't' }, 'salt');
    expect(expectOk(await verifyWebhook('payu', { ...pu, secret: 'salt' })).payment!.amountMinor).toBe('9007199254740993123');
  });

  it('rejects JSON numbers above 2^53 - 1', async () => {
    const rp = await signWebhook('razorpay', '{"event":"payment.captured","payload":{"payment":{"entity":{"amount":9007199254740993}}}}', 's');
    expectReason(await verifyWebhook('razorpay', { ...rp, secret: 's' }), 'malformed_body');
  });
});

describe('F7 a request without authentication never gets a non-authentication reason', () => {
  it('payu: a JSON refund body without a hash is missing_header, not unsupported_event', async () => {
    const result = await verifyWebhook('payu', { rawBody: '{"action":"refund","status":"success"}', secret: 'salt' });
    expectReason(result, 'missing_header');
  });

  it('easebuzz: a JSON body is missing_header, not malformed_body', async () => {
    expectReason(await verifyWebhook('easebuzz', { rawBody: '{"status":"success"}', secret: 'salt' }), 'missing_header');
  });

  it('payu and easebuzz: invalid JSON is missing_header, not malformed_body', async () => {
    expectReason(await verifyWebhook('payu', { rawBody: '{not json', secret: 'salt' }), 'missing_header');
    expectReason(await verifyWebhook('easebuzz', { rawBody: '[1,', secret: 'salt' }), 'missing_header');
  });

  it('a form body with repeated fields and a wrong hash is bad_signature, not malformed_body', async () => {
    const rawBody = `${encodeForm({ ...payuSuccessFields, hash: 'ab'.repeat(64) })}&amount=1.00`;
    expectReason(await verifyWebhook('payu', { rawBody, secret: 'salt' }), 'bad_signature');
    expectReason(await verifyWebhook('easebuzz', { rawBody, secret: 'salt' }), 'bad_signature');
  });
});

describe('F8 verifyWebhook never throws and never rejects', () => {
  const settle = (run: () => Promise<unknown>) => {
    let value: unknown;
    try {
      value = run();
    } catch (error) {
      return Promise.resolve({ threw: error });
    }
    return Promise.resolve(value).then(
      (result) => ({ result }),
      (error: unknown) => ({ rejected: error }),
    );
  };

  it('a provider without a prototype resolves to invalid_options', async () => {
    const outcome = await settle(() => verifyWebhook(Object.create(null) as 'razorpay', {} as VerifyOptionsMap['razorpay']));
    expect(outcome).toMatchObject({ result: { ok: false, reason: 'invalid_options' } });
  });

  it('a provider whose toString throws resolves to invalid_options', async () => {
    const provider = { toString: () => { throw new Error('boom'); } };
    const outcome = await settle(() => verifyWebhook(provider as unknown as 'razorpay', {} as VerifyOptionsMap['razorpay']));
    expect(outcome).toMatchObject({ result: { ok: false, reason: 'invalid_options' } });
  });

  it('an option getter that throws a value without a prototype resolves to internal_error', async () => {
    const options = {
      get rawBody(): string {
        throw Object.create(null);
      },
      secret: 's',
    };
    const outcome = await settle(() => verifyWebhook('razorpay', options));
    expect(outcome).toMatchObject({ result: { ok: false, reason: 'internal_error' } });
  });
});

describe('F9 rawBody as ArrayBuffer or any ArrayBufferView, and Map-like headers', () => {
  it('accepts an ArrayBuffer and a DataView', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, 's');
    const bytes = utf8(request.rawBody);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    expectOk(await verifyWebhook('razorpay', { rawBody: buffer, headers: request.headers, secret: 's' }));
    expectOk(await verifyWebhook('razorpay', { rawBody: new DataView(buffer), headers: request.headers, secret: 's' }));
  });

  it('accepts a view into the middle of a larger buffer', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, 's');
    const body = utf8(request.rawBody);
    const larger = new Uint8Array(body.length + 10);
    larger.set(body, 5);
    const view = new DataView(larger.buffer, 5, body.length);
    expectOk(await verifyWebhook('razorpay', { rawBody: view, headers: request.headers, secret: 's' }));
  });

  it('looks up Map headers case-insensitively', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, 's');
    const headers = new Map([['X-Razorpay-Signature', request.headers['x-razorpay-signature']]]);
    expectOk(await verifyWebhook('razorpay', { rawBody: request.rawBody, headers, secret: 's' }));
  });

  it('looks up headers on any object with forEach', async () => {
    const request = await signWebhook('razorpay', razorpayPaymentCaptured, 's');
    const headers = {
      forEach(callback: (value: string, name: string) => void) {
        callback(request.headers['x-razorpay-signature'], 'X-RAZORPAY-SIGNATURE');
      },
    };
    expectOk(await verifyWebhook('razorpay', { rawBody: request.rawBody, headers, secret: 's' }));
  });
});
