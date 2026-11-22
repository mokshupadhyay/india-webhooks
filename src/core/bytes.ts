// Byte helpers built on APIs every target runtime has (TextEncoder and
// TextDecoder exist in Node 18+, Bun, Deno and edge runtimes). The global
// types are declared locally so the package does not depend on the DOM or
// Node type libraries.

interface TextEncoderLike {
  encode(input: string): Uint8Array;
}

interface TextDecoderLike {
  decode(input: Uint8Array): string;
}

interface TextCodecGlobals {
  TextEncoder: new () => TextEncoderLike;
  TextDecoder: new (label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean }) => TextDecoderLike;
}

const globals = globalThis as unknown as TextCodecGlobals;
const encoder = new globals.TextEncoder();
const strictDecoder = new globals.TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const lenientDecoder = new globals.TextDecoder('utf-8', { ignoreBOM: true });

export const utf8 = (text: string): Uint8Array => encoder.encode(text);

/** Decodes UTF-8 and returns `null` for invalid input. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return null;
  }
}

/** Decodes UTF-8, replacing invalid sequences with U+FFFD, as form decoding does. */
export const decodeUtf8 = (bytes: Uint8Array): string => lenientDecoder.decode(bytes);

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding (RFC 4648 section 4). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += `${B64[n >> 18]}${B64[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${B64[n >> 18]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`;
  }
  return out;
}

/** Strict standard base64 decoding. Returns `null` for anything that is not canonical base64. */
export function fromBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const a = B64.indexOf(text[i]);
    const b = B64.indexOf(text[i + 1]);
    const c = text[i + 2] === '=' ? 0 : B64.indexOf(text[i + 2]);
    const d = text[i + 3] === '=' ? 0 : B64.indexOf(text[i + 3]);
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  // Reject non-canonical encodings whose unused bits are set.
  return toBase64(out) === text ? out : null;
}

/**
 * Compares two byte strings in time that depends only on their lengths.
 * Signature lengths are public, so returning early on a length mismatch
 * reveals nothing secret.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Constant-time comparison of two strings by their UTF-8 bytes. */
export const safeEqualText = (expected: string, received: string): boolean =>
  timingSafeEqual(utf8(expected), utf8(received));
