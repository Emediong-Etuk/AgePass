// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Midnight.js reads private state through a PrivateStateProvider. In the browser the
// authoritative copy lives in our encrypted vault (lib/vault.ts); this provider only holds it
// in memory for the duration of a transaction, so nothing private is ever written unencrypted.

import type { ContractAddress, SigningKey } from '@midnight-ntwrk/compact-runtime';
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';

const unsupported = (what: string) => () =>
  Promise.reject(new Error(`AgePass: ${what} is not supported in the browser wallet`));

export function memoryPrivateStateProvider<PS>(): PrivateStateProvider<string, PS> {
  const states = new Map<string, Map<string, PS>>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  let address: ContractAddress | null = null;

  const scoped = (): Map<string, PS> => {
    if (address === null) throw new Error('AgePass: contract address not set for private state');
    let m = states.get(address);
    if (!m) states.set(address, (m = new Map()));
    return m;
  };

  return {
    setContractAddress: (a) => {
      address = a;
    },
    set: async (id, state) => void scoped().set(id, state),
    get: async (id) => scoped().get(id) ?? null,
    remove: async (id) => void scoped().delete(id),
    clear: async () => void (address !== null && states.delete(address)),
    setSigningKey: async (a, k) => void signingKeys.set(a, k),
    getSigningKey: async (a) => signingKeys.get(a) ?? null,
    removeSigningKey: async (a) => void signingKeys.delete(a),
    clearSigningKeys: async () => signingKeys.clear(),
    exportPrivateStates: unsupported('exporting private state'),
    importPrivateStates: unsupported('importing private state'),
    exportSigningKeys: unsupported('exporting signing keys'),
    importSigningKeys: unsupported('importing signing keys'),
  };
}
