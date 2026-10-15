// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Every hash AgePass needs off-chain comes from the contract's exported *pure circuits*,
// executed from the compiler-generated JavaScript. Nothing is re-implemented here, so
// TypeScript and the circuits can never disagree about a key, commitment, nym or site id.

import { pureCircuits, type StoredCredential } from '@agepass/contract';
import { AgePassInputError } from './bytes.js';

const DOMAIN_BYTES = 128;

export const computeAdminPk = (sk: Uint8Array): Uint8Array => pureCircuits.adminPublicKey(sk);
export const computeIssuerPk = (sk: Uint8Array): Uint8Array => pureCircuits.issuerPublicKey(sk);
export const computeHolderPk = (sk: Uint8Array): Uint8Array => pureCircuits.holderPublicKey(sk);
export const computeNym = (sk: Uint8Array, siteId: Uint8Array): Uint8Array =>
  pureCircuits.sitePseudonym(sk, siteId);
export const computeCommitment = (cred: StoredCredential, holderPk: Uint8Array): Uint8Array =>
  pureCircuits.credentialCommitment(cred, holderPk);

/**
 * Canonical form of a site domain: lower case, no scheme, path, port or trailing dot.
 * "https://Shop.Example.com:443/age" and "shop.example.com" are the same site.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  d = d.split(/[/?#]/)[0] ?? '';
  d = d.replace(/:\d+$/, '').replace(/\.$/, '');
  if (d.length === 0 || !/^[a-z0-9.-]+$/.test(d) || d.startsWith('.') || d.includes('..')) {
    throw new AgePassInputError(`AgePass: "${input}" is not a valid site domain`);
  }
  return d;
}

/** siteId = siteIdFor(UTF-8 domain, zero-padded to 128 bytes), computed by the contract. */
export function computeSiteId(domain: string): Uint8Array {
  const encoded = new TextEncoder().encode(normalizeDomain(domain));
  if (encoded.length > DOMAIN_BYTES) {
    throw new AgePassInputError(`AgePass: site domain longer than ${DOMAIN_BYTES} bytes`);
  }
  const padded = new Uint8Array(DOMAIN_BYTES);
  padded.set(encoded);
  return pureCircuits.siteIdFor(padded);
}
