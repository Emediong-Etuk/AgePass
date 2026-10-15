// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Turns any thrown value into plain language plus a one-line fix. The CLI prints these and
// the app shows them with a "details" expander, so users never face a raw stack trace.

export type FriendlyError = {
  readonly title: string;
  readonly fix?: string;
  readonly detail: string;
  /** True when the failure happened locally and nothing was sent to the network. */
  readonly nothingShared: boolean;
};

type Rule = { test: RegExp; title: string; fix?: string; nothingShared: boolean };

const RULES: Rule[] = [
  {
    test: /age requirement not met/i,
    title: "AgePass couldn't confirm this request.",
    fix: 'Your credential does not meet the age this site asked for.',
    nothingShared: true,
  },
  {
    test: /credential has expired/i,
    title: 'Your AgePass credential has expired.',
    fix: 'Ask your issuer for a new credential.',
    nothingShared: true,
  },
  {
    test: /challenge was already answered/i,
    title: 'This request was already answered.',
    fix: 'Ask the site for a fresh request.',
    nothingShared: true,
  },
  {
    test: /never issued|not in the AgePass registry|path does not match/i,
    title: 'This credential is not in the AgePass registry.',
    fix: 'Import the receipt from your issuer again, or ask them to re-issue.',
    nothingShared: true,
  },
  {
    test: /no credential on this device/i,
    title: 'No credential on this device yet.',
    fix: 'Import the receipt your issuer gave you.',
    nothingShared: true,
  },
  {
    test: /only the admin/i,
    title: 'Only the AgePass admin can do that.',
    nothingShared: true,
  },
  {
    test: /not an approved issuer/i,
    title: 'This key is not an approved issuer.',
    fix: 'Ask the AgePass admin to approve your issuer key.',
    nothingShared: true,
  },
  {
    test: /6300|proof server|prover|ECONNREFUSED.*6300/i,
    title: 'The local proof server is not reachable.',
    fix: 'Start it: docker run -p 6300:6300 midnightntwrk/proof-server:8.1.3 midnight-proof-server -v',
    nothingShared: true,
  },
  {
    test: /insufficient|not enough|dust|fee/i,
    title: 'Your wallet cannot pay the transaction fee.',
    fix: 'Fees are paid in DUST: get tNIGHT from the faucet and register it for DUST generation.',
    nothingShared: true,
  },
  {
    test: /sync/i,
    title: 'Your wallet is still syncing.',
    fix: 'Wait for the wallet to finish syncing, then try again.',
    nothingShared: true,
  },
  {
    test: /rejected|denied|user declined|cancel/i,
    title: 'The request was declined in the wallet.',
    nothingShared: true,
  },
  {
    test: /passphrase is too weak/i,
    title: 'Choose a stronger passphrase.',
    nothingShared: true,
  },
];

export function describeError(error: unknown): FriendlyError {
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'Unknown error');
  for (const r of RULES) {
    if (r.test.test(detail)) {
      return {
        title: r.title,
        detail,
        nothingShared: r.nothingShared,
        ...(r.fix ? { fix: r.fix } : {}),
      };
    }
  }
  const agepass = /AgePass: ([^\n]+)/.exec(detail);
  return {
    title: agepass?.[1] ?? 'Something went wrong.',
    detail,
    nothingShared: false,
  };
}
