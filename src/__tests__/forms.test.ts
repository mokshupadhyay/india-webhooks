import { encodeForm, parseForm } from '../core/body';
import { utf8 } from '../core/bytes';
import { verifyWebhook } from '../index';
import { verifyPayuWebhook } from '../payu';
import { verifyEasebuzzWebhook } from '../easebuzz';
import { signWebhook } from '../testing';
import { payuRefundJson, payuSuccessFields } from './fixtures';
import { changeChar, expectOk, expectReason, indexes } from './helpers';

const SDK_FIELDS = {
  key: 'bjg$121',
  txnid: '3123',
  amount: '1000',
  productinfo: 'mobile',
  firstname: 'Jacob',
  email: 'test@payu.in',
  status: 'success',
};
const SDK_HASH =
  '687c82156a84271a7a6c63d0e8774d5ac567d9b894a334a47d72e47b72392a5167a1b2add5b253490b70731d9eb3e3a3b7225e0c5f26829befafbbee71977c4c';

const SALT = 'payu_test_salt';

/** Form fields of a signed body, with one field replaced. */
function withField(rawBody: string, name: string, value: string): string {
  return encodeForm({ ...fieldsOf(rawBody), [name]: value });
}

const fieldsOf = (rawBody: string): Record<string, string> => parseForm(utf8(rawBody)).fields;

describe('payu', () => {
  it('accepts the official SDK reverse-hash test vector', async () => {
    // payu-sdk-node tests/payu/hasher.test.js
    const rawBody = encodeForm({ ...SDK_FIELDS, hash: SDK_HASH });
    const event = expectOk(await verifyWebhook('payu', { rawBody, secret: 'vhgvs75' }));
    expect(event).toMatchObject({
      provider: 'payu',
      type: 'payment.captured',
      id: '3123:success',
      payment: { orderId: '3123', amountMinor: '100000', status: 'success' },
    });
  });

  it('rejects the SDK test truncated hash', async () => {
    const rawBody = encodeForm({ ...SDK_FIELDS, hash: '19d0822939b32b371847521c89aba3521de3a9bf' });
    expectReason(await verifyWebhook('payu', { rawBody, secret: 'vhgvs75' }), 'bad_signature');
  });

  it('prefixes additionalCharges as documented', async () => {
    // sha512("10.00|vhgvs75|success|||||||||||test@payu.in|Jacob|mobile|1000|3123|bjg$121"), via `shasum -a 512`.
    const hash =
      '35e64908cc3882e9a7a242a19ae9bada1e33601585971fd9939d2777a60754d9278ff5b36d73b2a47dc24bca2e0e2568647e8f4d6749ed2b9ec0e979324d98d8';
    const rawBody = encodeForm({ ...SDK_FIELDS, additionalCharges: '10.00', hash });
    expectOk(await verifyWebhook('payu', { rawBody, secret: 'vhgvs75' }));
    const withoutCharges = encodeForm({ ...SDK_FIELDS, hash });
    expectReason(await verifyWebhook('payu', { rawBody: withoutCharges, secret: 'vhgvs75' }), 'bad_signature');
  });

  it('round-trips the documented success payload', async () => {
    const request = await signWebhook('payu', payuSuccessFields, SALT);
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const event = expectOk(await verifyPayuWebhook({ ...request, secret: SALT }));
    expect(event.payment).toEqual({
      id: '27553369917',
      orderId: 'T2603041446091822117753',
      amountMinor: '4000',
      currency: null,
      status: 'success',
      method: 'SBQR',
    });
    expect(event.raw.addedon).toBe('2026-03-04 14:46:14');
  });

  it('maps failure, pending and success from the hashed status only', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ status: 'failure' }, 'payment.failed'],
      [{ status: 'pending' }, 'payment.pending'],
      // `unmappedstatus` is not hashed, so it does not change the type; it is kept in `unverified`.
      [{ status: 'success', unmappedstatus: 'auth' }, 'payment.captured'],
      [{ status: 'weird' }, 'unknown'],
    ];
    for (const [override, type] of cases) {
      const request = await signWebhook('payu', { ...payuSuccessFields, ...override }, SALT);
      const event = expectOk(await verifyWebhook('payu', { ...request, secret: SALT }));
      expect(event.type).toBe(type);
      expect(event.unverified && event.unverified.unmappedstatus).toBe(override.unmappedstatus || 'captured');
    }
  });

  it('fails when any hashed field changes by one character', async () => {
    const request = await signWebhook('payu', { ...payuSuccessFields, firstname: 'Asha', email: 'a@b.in', udf1: 'u1' }, SALT);
    const fields = fieldsOf(request.rawBody);
    for (const name of ['status', 'udf5', 'udf4', 'udf1', 'email', 'firstname', 'productinfo', 'amount', 'txnid', 'key']) {
      const rawBody = withField(request.rawBody, name, changeChar(fields[name], 0));
      expectReason(await verifyWebhook('payu', { ...request, rawBody, secret: SALT }), 'bad_signature');
    }
  });

  it('fails on any one-character change to the hash', async () => {
    const request = await signWebhook('payu', payuSuccessFields, SALT);
    const hash = fieldsOf(request.rawBody).hash;
    for (const i of indexes(hash)) {
      const rawBody = withField(request.rawBody, 'hash', changeChar(hash, i));
      expectReason(await verifyWebhook('payu', { ...request, rawBody, secret: SALT }), 'bad_signature');
    }
  });

  it('fails with the wrong salt or no hash field', async () => {
    const request = await signWebhook('payu', payuSuccessFields, SALT);
    expectReason(await verifyWebhook('payu', { ...request, secret: 'other' }), 'bad_signature');
    expectReason(await verifyWebhook('payu', { rawBody: encodeForm(payuSuccessFields), secret: SALT }), 'missing_header');
  });

  it('rejects a duplicated hashed field with a different value', async () => {
    const request = await signWebhook('payu', payuSuccessFields, SALT);
    const rawBody = `${request.rawBody}&amount=1.00`;
    expectReason(await verifyWebhook('payu', { ...request, rawBody, secret: SALT }), 'malformed_body');
  });

  it('reports JSON refund webhooks as missing_header, because PayU does not sign them', async () => {
    const result = await verifyWebhook('payu', { rawBody: payuRefundJson, secret: SALT });
    expectReason(result, 'missing_header');
    if (!result.ok) expect(result.message).toMatch(/refund and dispute webhooks are JSON and carry no hash/);
  });

  it('reports a signed but invalid amount as malformed', async () => {
    const request = await signWebhook('payu', { ...payuSuccessFields, amount: '40.005' }, SALT);
    expectReason(await verifyWebhook('payu', { ...request, secret: SALT }), 'malformed_body');
  });
});

describe('easebuzz', () => {
  const FIELDS = {
    key: 'EBKEY',
    txnid: 'TXN42',
    amount: '101.50',
    productinfo: 'Test product',
    firstname: 'Asha',
    email: 'buyer@example.com',
    udf1: 'order-42',
    status: 'success',
    easepayid: 'E2511220ABCDEF',
    mode: 'UPI',
  };

  it('matches the hash sequence of Easebuzz\'s own webhook handler', async () => {
    // sha512("ebsalt|success|<udf10..udf2 empty>|order-42|buyer@example.com|Asha|Test product|101.50|TXN42|EBKEY"),
    // computed with `shasum -a 512`.
    const hash =
      'd64548d603d62653a94e1da6f2084deb0a200601df1bcf82502a16370465dc618b48550708c3df6875d63eaec1947c1260d3ea25cff27940a05e6c5c1551e323';
    const event = expectOk(await verifyWebhook('easebuzz', { rawBody: encodeForm({ ...FIELDS, hash }), secret: 'ebsalt' }));
    expect(event).toMatchObject({
      provider: 'easebuzz',
      type: 'payment.captured',
      payment: { id: 'E2511220ABCDEF', orderId: 'TXN42', amountMinor: '10150', method: 'UPI', status: 'success' },
    });
  });

  it('round-trips and maps statuses', async () => {
    const cases: [string, string][] = [
      ['success', 'payment.captured'],
      ['pending', 'payment.pending'],
      ['usercancelled', 'payment.failed'],
      // Easebuzz's own handler marks every other status failed.
      ['failure', 'payment.failed'],
    ];
    for (const [status, type] of cases) {
      const request = await signWebhook('easebuzz', { ...FIELDS, status }, 'ebsalt');
      expect(expectOk(await verifyEasebuzzWebhook({ ...request, secret: 'ebsalt' })).type).toBe(type);
    }
  });

  it('fails when any hashed field changes, with a wrong salt, or without a hash', async () => {
    const request = await signWebhook('easebuzz', { ...FIELDS, udf10: 'last' }, 'ebsalt');
    const fields = fieldsOf(request.rawBody);
    for (const name of ['status', 'udf10', 'udf1', 'email', 'firstname', 'productinfo', 'amount', 'txnid', 'key', 'hash']) {
      const rawBody = withField(request.rawBody, name, changeChar(fields[name], 0));
      expectReason(await verifyWebhook('easebuzz', { ...request, rawBody, secret: 'ebsalt' }), 'bad_signature');
    }
    expectReason(await verifyWebhook('easebuzz', { ...request, secret: 'wrong' }), 'bad_signature');
    expectReason(await verifyWebhook('easebuzz', { rawBody: encodeForm(FIELDS), secret: 'ebsalt' }), 'missing_header');
  });

  it('reports a JSON body as missing_header, since it carries no hash', async () => {
    expectReason(await verifyWebhook('easebuzz', { rawBody: '{"status":"success"}', secret: 'ebsalt' }), 'missing_header');
  });
});
