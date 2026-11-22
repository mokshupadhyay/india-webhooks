import { minorFromDecimal, minorFromInteger, minorToDecimal } from '../core/amount';
import { fromBase64, timingSafeEqual, toBase64, toHex, utf8 } from '../core/bytes';
import { digest, hmacSha256 } from '../core/crypto';
import { readHeader } from '../core/headers';
import type { HeadersLike } from '../core/types';

describe('bytes', () => {
  it('encodes hex and base64 (RFC 4648 test vectors)', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [text, encoded] of vectors) {
      expect(toBase64(utf8(text))).toBe(encoded);
      expect(Array.from(fromBase64(encoded) || [])).toEqual(Array.from(utf8(text)));
    }
    expect(toHex(utf8('foobar'))).toBe('666f6f626172');
    expect(toHex(new Uint8Array([0, 15, 16, 255]))).toBe('000f10ff');
  });

  it('rejects non-canonical base64', () => {
    expect(fromBase64('QQ')).toBeNull();
    expect(fromBase64('QR==')).toBeNull();
    expect(fromBase64('Q Q==')).toBeNull();
    expect(fromBase64('QQ==')).toEqual(utf8('A'));
  });

  it('compares bytes', () => {
    expect(timingSafeEqual(utf8('abc'), utf8('abc'))).toBe(true);
    expect(timingSafeEqual(utf8('abc'), utf8('abd'))).toBe(false);
    expect(timingSafeEqual(utf8('abc'), utf8('abcd'))).toBe(false);
  });
});

describe('crypto', () => {
  it('matches known HMAC-SHA256 and SHA-512 values', async () => {
    // RFC 4231 test case 2.
    expect(toHex(await hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    expect(toHex(await digest('SHA-512', utf8('abc')))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
  });
});

describe('readHeader', () => {
  it('reads plain objects case-insensitively, including arrays', () => {
    expect(readHeader({ 'X-Razorpay-Signature': 'abc' }, 'x-razorpay-signature')).toBe('abc');
    expect(readHeader({ authorization: ['one', 'two'] }, 'Authorization')).toBe('one');
    expect(readHeader({ authorization: '' }, 'authorization')).toBeNull();
    expect(readHeader(undefined, 'authorization')).toBeNull();
  });

  it('reads Fetch Headers', () => {
    const HeadersCtor = (globalThis as unknown as { Headers: new (init: Record<string, string>) => HeadersLike })
      .Headers;
    expect(readHeader(new HeadersCtor({ 'X-Webhook-Timestamp': '1' }), 'x-webhook-timestamp')).toBe('1');
  });
});

describe('amounts', () => {
  it('reads integer minor units', () => {
    expect(minorFromInteger(50000)).toBe('50000');
    expect(minorFromInteger('007')).toBe('7');
    expect(minorFromInteger(0)).toBe('0');
    expect(minorFromInteger(1.5)).toBeNull();
    expect(minorFromInteger(-1)).toBeNull();
    expect(minorFromInteger(2 ** 60)).toBeNull();
    expect(minorFromInteger('1e3')).toBeNull();
  });

  it('converts rupees with up to two decimals to paise', () => {
    expect(minorFromDecimal(1.8)).toBe('180');
    expect(minorFromDecimal(6)).toBe('600');
    expect(minorFromDecimal('40.00')).toBe('4000');
    expect(minorFromDecimal('0.07')).toBe('7');
    expect(minorFromDecimal('12.5')).toBe('1250');
    expect(minorFromDecimal('12.500')).toBe('1250');
    expect(minorFromDecimal(0.1 + 0.2)).toBeNull();
    expect(minorFromDecimal('12.345')).toBeNull();
    expect(minorFromDecimal('-1.00')).toBeNull();
    expect(minorFromDecimal('1,000.00')).toBeNull();
    expect(minorFromDecimal('')).toBeNull();
    expect(minorFromDecimal(Number.NaN)).toBeNull();
  });

  it('formats minor units back to two decimals', () => {
    expect(minorToDecimal('0')).toBe('0.00');
    expect(minorToDecimal('7')).toBe('0.07');
    expect(minorToDecimal('180')).toBe('1.80');
    expect(minorToDecimal('123456')).toBe('1234.56');
  });
});
