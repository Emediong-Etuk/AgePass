// Exact amount maths. Strings and BigInt only, never floating point.
import { atomicAmount } from "./paybox.js";
import { UserError } from "./errors.js";

const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

/** Converts a decimal string such as "2.5" into atomic units for a token with `decimals` places. */
export function toAtomic(amount: string, decimals: number, symbol: string, field = "amount"): bigint {
  const value = amount.trim();
  if (value.length === 0 || value.length > 80) {
    throw new UserError(`The ${field} "${amount}" isn't a valid number. Use a plain decimal like 2 or 2.5.`);
  }
  const match = DECIMAL.exec(value);
  if (!match) {
    throw new UserError(
      `The ${field} "${amount}" isn't a valid number. Use a plain decimal like 2 or 2.5, with no commas, spaces, signs or currency symbols, and a leading 0 for amounts under 1 (0.5, not .5).`,
    );
  }
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new UserError(
      `The ${field} ${value} has ${fraction.length} decimal places, but ${symbol} only allows ${decimals}. Round it to at most ${decimals} decimal places.`,
    );
  }
  return BigInt(atomicAmount(value, decimals));
}

/** Formats atomic units as the shortest exact decimal string, e.g. 2500000 with 6 decimals is "2.5". */
export function fromAtomic(atomic: bigint, decimals: number): string {
  if (atomic < 0n) throw new Error("negative amount");
  const digits = atomic.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Parses an EIP-681 number (e.g. "25000000000000000", "2.5e16", "2.5E+16") into an exact integer.
 * The result must be a whole number: fractional atomic units are rejected.
 */
export function parseEip681Integer(raw: string, field: string): bigint {
  const value = raw.trim();
  const match = /^\+?([0-9]+)(?:\.([0-9]+))?(?:[eE]\+?([0-9]{1,3}))?$/.exec(value);
  if (!match) {
    if (value.startsWith("-")) throw new UserError(`The ${field} in this link is negative, which isn't a valid payment.`);
    throw new UserError(`The ${field} "${raw}" in this link isn't a valid number. Ask the payee for a new link.`);
  }
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (exponent > 78) throw new UserError(`The ${field} "${raw}" in this link is far too large to be a real payment.`);
  let digits = whole + fraction;
  const shift = exponent - fraction.length;
  if (shift >= 0) {
    digits += "0".repeat(shift);
  } else {
    const dropped = digits.slice(digits.length + shift);
    if (/[^0]/.test(dropped)) {
      throw new UserError(
        `The ${field} "${raw}" in this link isn't a whole number of the token's smallest unit, so it can't be paid exactly. Ask the payee for a new link.`,
      );
    }
    digits = digits.slice(0, digits.length + shift) || "0";
  }
  const result = BigInt(digits);
  if (result >= 2n ** 256n) throw new UserError(`The ${field} "${raw}" in this link is far too large to be a real payment.`);
  return result;
}
