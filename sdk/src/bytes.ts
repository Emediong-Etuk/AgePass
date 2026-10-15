// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Small byte helpers that work in Node 22 and in browsers (no Buffer dependency).

export class AgePassInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgePassInputError';
  }
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Parses hex (optionally 0x-prefixed). `expectedLength` is in bytes. */
export function fromHex(hex: string, expectedLength?: number, what = 'value'): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) {
    throw new AgePassInputError(`AgePass: ${what} must be hexadecimal`);
  }
  if (expectedLength !== undefined && clean.length !== expectedLength * 2) {
    throw new AgePassInputError(
      `AgePass: ${what} must be ${expectedLength} bytes (${expectedLength * 2} hex characters)`,
    );
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const randomBytes32 = (): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(32));

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Short, human-friendly rendering such as `0x3fa1…9c0e` for UIs and logs. */
export const shortHex = (bytes: Uint8Array | string, keep = 4): string => {
  const h = typeof bytes === 'string' ? bytes.replace(/^0x/i, '') : toHex(bytes);
  return h.length <= keep * 2 ? `0x${h}` : `0x${h.slice(0, keep)}…${h.slice(-keep)}`;
};

const B64URL = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(encoded: string): string {
  if (!B64URL.test(encoded)) throw new AgePassInputError('AgePass: malformed link data');
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
