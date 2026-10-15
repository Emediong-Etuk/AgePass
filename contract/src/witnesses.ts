// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Witnesses: the only bridge from the holder's device into a circuit. Whatever they return
// stays private unless the circuit explicitly disclose()s something derived from it.

import type { MerkleTreePath, WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { CredentialData, Ledger } from './managed/agepass/contract/index.js';

/** A credential as held on the holder's device. Mirrors the Compact `CredentialData` struct. */
export type StoredCredential = {
  readonly birthDate: bigint; // YYYYMMDD
  readonly expiresOn: bigint; // YYYYMMDD
  readonly issuerPk: Uint8Array;
};

/**
 * Local, never-shared state for one AgePass participant. The same shape serves the admin,
 * an issuer and a holder: only holders ever carry a credential.
 */
export type AgePassPrivateState = {
  readonly secretKey: Uint8Array;
  readonly credential?: StoredCredential;
};

export const createAgePassPrivateState = (
  secretKey: Uint8Array,
  credential?: StoredCredential,
): AgePassPrivateState => {
  if (secretKey.length !== 32) {
    throw new AgePassWitnessError('AgePass: the secret key must be exactly 32 bytes');
  }
  return credential === undefined ? { secretKey } : { secretKey, credential };
};

/**
 * Thrown before any proof is attempted when local state cannot satisfy a circuit.
 * Messages are written for end users because the CLI and app surface them directly.
 */
export class AgePassWitnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgePassWitnessError';
  }
}

type Ctx = WitnessContext<Ledger, AgePassPrivateState>;

export const witnesses = {
  localSecretKey: ({ privateState }: Ctx): [AgePassPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],

  storedCredential: ({ privateState }: Ctx): [AgePassPrivateState, CredentialData] => {
    if (privateState.credential === undefined) {
      throw new AgePassWitnessError(
        'AgePass: no credential on this device yet. Import the receipt from your issuer first.',
      );
    }
    const { birthDate, expiresOn, issuerPk } = privateState.credential;
    return [privateState, { birthDate, expiresOn, issuerPk }];
  },

  // findPathForLeaf scans the public tree locally (O(n)); fine for a 2^16 tree and it means
  // the holder never has to remember the leaf index their issuer used.
  credentialPath: (
    { privateState, ledger }: Ctx,
    commitment: Uint8Array,
  ): [AgePassPrivateState, MerkleTreePath<Uint8Array>] => {
    const path = ledger.credentials.findPathForLeaf(commitment);
    if (path === undefined) {
      throw new AgePassWitnessError(
        'AgePass: your credential is not in the AgePass registry. It may not have been issued yet, or the details on this device do not match what the issuer recorded.',
      );
    }
    return [privateState, path];
  },
};
