// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// The issuer hands the holder a receipt after issuing. It carries the attested dates back
// to the holder's device (the only place they live afterwards). It must be handed over
// privately (QR on screen, local file) and is never posted anywhere.

import type { Ledger, StoredCredential } from '@agepass/contract';
import { AgePassInputError, bytesEqual, fromHex, toHex } from './bytes.js';
import { formatIsoDate, parseIsoDate } from './dates.js';
import { computeCommitment, computeHolderPk } from './keys.js';

export type CredentialReceipt = {
  readonly kind: 'agepass-credential';
  readonly version: 1;
  readonly contractAddress: string;
  readonly issuerName: string;
  readonly issuerPk: string;
  readonly holderPk: string;
  readonly birthDate: string; // YYYY-MM-DD
  readonly expiresOn: string; // YYYY-MM-DD
  readonly commitment: string;
  readonly txId?: string;
};

export function createReceipt(opts: {
  contractAddress: string;
  issuerName: string;
  issuerPk: Uint8Array;
  holderPk: Uint8Array;
  birthDate: bigint;
  expiresOn: bigint;
  txId?: string;
}): CredentialReceipt {
  const credential: StoredCredential = {
    birthDate: opts.birthDate,
    expiresOn: opts.expiresOn,
    issuerPk: opts.issuerPk,
  };
  return {
    kind: 'agepass-credential',
    version: 1,
    contractAddress: opts.contractAddress,
    issuerName: opts.issuerName,
    issuerPk: toHex(opts.issuerPk),
    holderPk: toHex(opts.holderPk),
    birthDate: formatIsoDate(opts.birthDate),
    expiresOn: formatIsoDate(opts.expiresOn),
    commitment: toHex(computeCommitment(credential, opts.holderPk)),
    ...(opts.txId ? { txId: opts.txId } : {}),
  };
}

export function parseReceipt(input: string | unknown): CredentialReceipt {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new AgePassInputError('AgePass: this receipt is not valid JSON');
    }
  }
  const r = raw as Partial<CredentialReceipt> | null;
  if (r === null || typeof r !== 'object' || r.kind !== 'agepass-credential' || r.version !== 1) {
    throw new AgePassInputError('AgePass: this is not an AgePass credential receipt');
  }
  for (const k of [
    'contractAddress',
    'issuerName',
    'issuerPk',
    'holderPk',
    'birthDate',
    'expiresOn',
    'commitment',
  ] as const) {
    if (typeof r[k] !== 'string') throw new AgePassInputError(`AgePass: receipt is missing ${k}`);
  }
  return r as CredentialReceipt;
}

export type ImportedCredential = {
  readonly credential: StoredCredential;
  readonly issuerName: string;
  readonly contractAddress: string;
  readonly commitment: Uint8Array;
  /** False if the issuer has since been removed from the approved list (informational). */
  readonly issuerStillApproved: boolean;
};

/**
 * Checks a receipt against the holder's own secret and the public tree before accepting it:
 * the receipt must be for *this* holder, its fields must hash to the stated commitment, and
 * that commitment must actually be in the AgePass registry.
 */
export function verifyReceipt(
  receipt: CredentialReceipt,
  holderSecretKey: Uint8Array,
  ledger: Ledger,
): ImportedCredential {
  const holderPk = computeHolderPk(holderSecretKey);
  if (!bytesEqual(holderPk, fromHex(receipt.holderPk, 32, 'holder key'))) {
    throw new AgePassInputError(
      'AgePass: this receipt was issued to a different holder key, not to this wallet.',
    );
  }
  const credential: StoredCredential = {
    birthDate: parseIsoDate(receipt.birthDate),
    expiresOn: parseIsoDate(receipt.expiresOn),
    issuerPk: fromHex(receipt.issuerPk, 32, 'issuer key'),
  };
  const commitment = computeCommitment(credential, holderPk);
  if (toHex(commitment) !== receipt.commitment.toLowerCase()) {
    throw new AgePassInputError(
      'AgePass: the receipt details do not match its commitment. It may have been altered.',
    );
  }
  if (ledger.credentials.findPathForLeaf(commitment) === undefined) {
    throw new AgePassInputError(
      'AgePass: this credential is not in the AgePass registry yet. Wait for the issuer transaction to confirm and try again.',
    );
  }
  return {
    credential,
    issuerName: receipt.issuerName,
    contractAddress: receipt.contractAddress,
    commitment,
    issuerStillApproved: ledger.issuers.member(credential.issuerPk),
  };
}
