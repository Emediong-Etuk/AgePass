// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// The site-side check. `cutoffDate` and `checkedOn` are supplied by the holder's client, so
// a successful proveAge only proves the holder satisfied *the dates they submitted*. The
// site must therefore compare the on-chain record against the challenge IT issued. That
// comparison lives here so every integrator gets it right.

import type { Ledger, Verification } from '@agepass/contract';
import { fromHex, toHex } from './bytes.js';
import type { AgePassChallenge } from './challenge.js';

export type VerificationFailure = 'wrong-site' | 'wrong-cutoff' | 'wrong-date';

export type VerificationResult =
  | { readonly status: 'verified'; readonly nym: string; readonly record: Verification }
  | { readonly status: 'pending' }
  | {
      readonly status: 'rejected';
      readonly reason: VerificationFailure;
      readonly message: string;
      readonly record: Verification;
    };

const FAILURE_MESSAGES: Record<VerificationFailure, string> = {
  'wrong-site': 'The proof was made for a different site.',
  'wrong-cutoff': 'The proof used a different age cutoff than this site asked for.',
  'wrong-date': 'The proof used a different check date than this site asked for.',
};

/** Pure comparison of a ledger record with the challenge the site issued. */
export function evaluateRecord(
  challenge: AgePassChallenge,
  record: Verification | undefined,
): VerificationResult {
  if (record === undefined) return { status: 'pending' };
  const reject = (reason: VerificationFailure): VerificationResult => ({
    status: 'rejected',
    reason,
    message: FAILURE_MESSAGES[reason],
    record,
  });
  if (toHex(record.siteId) !== challenge.siteId.toLowerCase()) return reject('wrong-site');
  if (record.cutoffDate !== BigInt(challenge.cutoffDate)) return reject('wrong-cutoff');
  if (record.checkedOn !== BigInt(challenge.checkedOn)) return reject('wrong-date');
  return { status: 'verified', nym: toHex(record.nym), record };
}

/** Looks up the record for a challenge in a ledger snapshot. */
export function evaluateLedger(challenge: AgePassChallenge, ledger: Ledger): VerificationResult {
  const id = fromHex(challenge.challengeId, 32, 'challenge id');
  return evaluateRecord(
    challenge,
    ledger.verifications.member(id) ? ledger.verifications.lookup(id) : undefined,
  );
}

/** Anything that can fetch the current AgePass ledger (indexer, simulator, test double). */
export type LedgerReader = () => Promise<Ledger | null>;

export class AgePassNotFoundError extends Error {
  constructor(address: string) {
    super(`AgePass: no AgePass contract found at ${address} on this network`);
    this.name = 'AgePassNotFoundError';
  }
}

export async function checkVerification(
  readLedger: LedgerReader,
  challenge: AgePassChallenge,
  address = 'the configured address',
): Promise<VerificationResult> {
  const ledger = await readLedger();
  if (ledger === null) throw new AgePassNotFoundError(address);
  return evaluateLedger(challenge, ledger);
}

/** Polls until the record appears (or is rejected), or until `timeoutMs` elapses. */
export async function waitForVerification(
  readLedger: LedgerReader,
  challenge: AgePassChallenge,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<VerificationResult> {
  const interval = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  for (;;) {
    const result = await checkVerification(readLedger, challenge);
    if (result.status !== 'pending' || Date.now() >= deadline || opts.signal?.aborted) {
      return result;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
