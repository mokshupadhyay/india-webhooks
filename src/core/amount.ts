// Conversions to integer minor units. Amounts are handled as decimal digit
// strings from start to finish, so no float arithmetic touches them.

const DIGITS = /^\d+$/;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

const stripLeadingZeros = (digits: string): string => digits.replace(/^0+(?=\d)/, '');

/**
 * Gateways that send amounts in minor units (Razorpay, PhonePe): a
 * non-negative safe integer, or a string of digits. Returns `null` otherwise.
 */
export function minorFromInteger(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === 'string' && DIGITS.test(value)) return stripLeadingZeros(value);
  return null;
}

/**
 * Gateways that send rupees with up to two decimals (Cashfree, PayU, Juspay,
 * Easebuzz), either as a JSON number or as a string such as `"40.00"`.
 * Extra fraction digits are accepted only when they are zeros. Returns `null`
 * for anything that is not an exact amount in paise.
 */
export function minorFromDecimal(value: unknown): string | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    // JSON numbers arrive as doubles. Their shortest decimal form equals the
    // digits that were sent as long as there are at most 15 significant
    // digits, which holds for any fractional amount below 10^13.
    if (!Number.isInteger(value) && value >= 1e13) return null;
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value;
  } else {
    return null;
  }
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const whole = match[1];
  const fraction = match[2] || '';
  if (fraction.length > 2 && !/^0+$/.test(fraction.slice(2))) return null;
  return stripLeadingZeros(whole + fraction.slice(0, 2).padEnd(2, '0'));
}

/** Formats integer minor units as a two-decimal major amount, for example `"1250"` as `"12.50"`. */
export function minorToDecimal(minor: string): string {
  const padded = minor.padStart(3, '0');
  return `${stripLeadingZeros(padded.slice(0, -2))}.${padded.slice(-2)}`;
}
