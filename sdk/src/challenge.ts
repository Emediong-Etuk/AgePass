// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// A challenge is the site's question: "is the holder at least `minAge` today?". It travels
// from the site to the holder's wallet (URL fragment, QR or CLI JSON) and back via the chain.

import {
  AgePassInputError,
  fromBase64Url,
  fromHex,
  randomBytes32,
  toBase64Url,
  toHex,
} from './bytes.js';
import { cutoffForAge, fromYYYYMMDD, toYYYYMMDD } from './dates.js';
import { computeSiteId, normalizeDomain } from './keys.js';

export type AgePassChallenge = {
  readonly kind: 'agepass-challenge';
  readonly version: 1;
  /** 32 random bytes, hex. Single use: the contract rejects a second answer. */
  readonly challengeId: string;
  readonly siteDomain: string;
  /** hex of siteIdFor(siteDomain) */
  readonly siteId: string;
  readonly minAge: number;
  /** YYYYMMDD: birth date must be on or before this */
  readonly cutoffDate: number;
  /** YYYYMMDD: the day the site asked */
  readonly checkedOn: number;
  /** Optional display name, e.g. "Corner Cellar (demo store)". Not part of the proof. */
  readonly siteName?: string;
};

/** The four values `proveAge` takes, in circuit types. */
export type ChallengeCircuitArgs = {
  readonly challengeId: Uint8Array;
  readonly siteId: Uint8Array;
  readonly cutoffDate: bigint;
  readonly checkedOn: bigint;
};

export function createChallenge(opts: {
  siteDomain: string;
  minAge: number;
  siteName?: string;
  today?: Date;
}): AgePassChallenge {
  const today = opts.today ?? new Date();
  const siteDomain = normalizeDomain(opts.siteDomain);
  return {
    kind: 'agepass-challenge',
    version: 1,
    challengeId: toHex(randomBytes32()),
    siteDomain,
    siteId: toHex(computeSiteId(siteDomain)),
    minAge: opts.minAge,
    cutoffDate: Number(cutoffForAge(opts.minAge, today)),
    checkedOn: Number(toYYYYMMDD(today)),
    ...(opts.siteName ? { siteName: opts.siteName } : {}),
  };
}

export const challengeToCircuitArgs = (c: AgePassChallenge): ChallengeCircuitArgs => ({
  challengeId: fromHex(c.challengeId, 32, 'challenge id'),
  siteId: fromHex(c.siteId, 32, 'site id'),
  cutoffDate: BigInt(c.cutoffDate),
  checkedOn: BigInt(c.checkedOn),
});

/**
 * Parses and *checks* a challenge received from elsewhere. The holder's wallet must not
 * trust the site's JSON blindly: the site id must really be the hash of the domain shown to
 * the user, and the cutoff must really correspond to the stated minimum age.
 */
export function parseChallenge(input: string | unknown): AgePassChallenge {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new AgePassInputError('AgePass: this age request is not valid JSON');
    }
  }
  const c = raw as Partial<AgePassChallenge> | null;
  if (c === null || typeof c !== 'object' || c.kind !== 'agepass-challenge' || c.version !== 1) {
    throw new AgePassInputError('AgePass: this is not an AgePass age request');
  }
  if (
    typeof c.challengeId !== 'string' ||
    typeof c.siteDomain !== 'string' ||
    typeof c.siteId !== 'string' ||
    typeof c.minAge !== 'number' ||
    typeof c.cutoffDate !== 'number' ||
    typeof c.checkedOn !== 'number'
  ) {
    throw new AgePassInputError('AgePass: the age request is missing fields');
  }
  fromHex(c.challengeId, 32, 'challenge id');
  fromYYYYMMDD(c.cutoffDate);
  fromYYYYMMDD(c.checkedOn);
  if (toHex(computeSiteId(c.siteDomain)) !== c.siteId.toLowerCase()) {
    throw new AgePassInputError(
      `AgePass: the request's site id does not belong to "${c.siteDomain}". It may be forged.`,
    );
  }
  if (BigInt(c.cutoffDate) !== cutoffForAge(c.minAge, fromYYYYMMDD(c.checkedOn))) {
    throw new AgePassInputError(
      `AgePass: the request's dates do not match "${c.minAge} or older". It may be forged.`,
    );
  }
  return {
    kind: 'agepass-challenge',
    version: 1,
    challengeId: c.challengeId.toLowerCase(),
    siteDomain: normalizeDomain(c.siteDomain),
    siteId: c.siteId.toLowerCase(),
    minAge: c.minAge,
    cutoffDate: c.cutoffDate,
    checkedOn: c.checkedOn,
    ...(typeof c.siteName === 'string' && c.siteName.length > 0
      ? { siteName: c.siteName.slice(0, 80) }
      : {}),
  };
}

/** For same-origin hand-off: `#/wallet?request=<this>`. */
export const encodeChallengeForUrl = (c: AgePassChallenge): string =>
  toBase64Url(JSON.stringify(c));

export const decodeChallengeFromUrl = (s: string): AgePassChallenge =>
  parseChallenge(fromBase64Url(s));

/** Days between the challenge's checkedOn and `today` (positive = challenge is older). */
export function challengeAgeInDays(c: AgePassChallenge, today = new Date()): number {
  const a = fromYYYYMMDD(c.checkedOn);
  const t = toYYYYMMDD(today);
  const b = fromYYYYMMDD(t);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}
