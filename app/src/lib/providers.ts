// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Browser Midnight.js providers: Lace balances and submits, the local proof server proves,
// keys are fetched from this site, private state lives only in memory (see vault.ts).
// Each provider is wrapped to report which stage a transaction is in, so the UI can show
// honest progress ("Generating zero-knowledge proof", "Approve in Lace", ...).

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { Binding, Proof, SignatureEnabled } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  type FinalizedTransaction,
  Transaction,
  type TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { PublicDataProvider, UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import {
  AgePassAPI,
  type AgePassCircuitId,
  type AgePassPrivateState,
  type AgePassProviders,
  fromHex,
  makeCompiledAgePass,
  toHex,
} from '@agepass/sdk';
import { NETWORK, PUBLIC_ENDPOINTS, zkAssetsBase } from './config';
import { memoryPrivateStateProvider } from './memoryPrivateState';

export type TxStage = 'preparing' | 'proving' | 'balancing' | 'submitting' | 'confirmed';

let publicProvider: PublicDataProvider | undefined;

/** Read-only indexer access for the explorer and the store. No wallet needed. */
export function publicDataProvider(): PublicDataProvider {
  setNetworkId(NETWORK);
  return (publicProvider ??= indexerPublicDataProvider(
    PUBLIC_ENDPOINTS.indexer,
    PUBLIC_ENDPOINTS.indexerWS,
  ));
}

export function browserProviders(
  api: ConnectedAPI,
  config: { indexerUri: string; indexerWsUri: string; proverServerUri?: string | undefined },
  shieldedKeys: { shieldedCoinPublicKey: string; shieldedEncryptionPublicKey: string },
  proofServer: string,
  onStage: (s: TxStage) => void,
): AgePassProviders {
  setNetworkId(NETWORK);
  const zkConfigProvider = new FetchZkConfigProvider<AgePassCircuitId>(
    zkAssetsBase(),
    fetch.bind(window),
  );
  const prover = httpClientProofProvider(proofServer, zkConfigProvider);
  return {
    privateStateProvider: memoryPrivateStateProvider<AgePassPrivateState>(),
    zkConfigProvider,
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
    proofProvider: {
      ...prover,
      proveTx: (...args: Parameters<typeof prover.proveTx>) => {
        onStage('proving');
        return prover.proveTx(...args);
      },
    },
    walletProvider: {
      getCoinPublicKey: () => shieldedKeys.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => shieldedKeys.shieldedEncryptionPublicKey,
      async balanceTx(tx: UnboundTransaction): Promise<FinalizedTransaction> {
        onStage('balancing');
        const { tx: balanced } = await api.balanceUnsealedTransaction(toHex(tx.serialize()));
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          'signature',
          'proof',
          'binding',
          fromHex(balanced),
        );
      },
    },
    midnightProvider: {
      async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
        onStage('submitting');
        await api.submitTransaction(toHex(tx.serialize()));
        const id = tx.identifiers()[0];
        if (id === undefined) throw new Error('AgePass: submitted transaction has no id');
        return id;
      },
    },
  };
}

export type ConnectedWallet = {
  api: ConnectedAPI;
  config: { indexerUri: string; indexerWsUri: string; proverServerUri?: string | undefined };
  proofServer: string;
};

/**
 * Joins the deployment as one participant, with their private state loaded into memory.
 * `onStage` receives progress for every transaction made through the returned API.
 */
export async function joinAs(
  wallet: ConnectedWallet,
  contractAddress: string,
  role: string,
  state: AgePassPrivateState,
  onStage: (s: TxStage) => void,
): Promise<AgePassAPI> {
  const keys = await wallet.api.getShieldedAddresses();
  const providers = browserProviders(wallet.api, wallet.config, keys, wallet.proofServer, onStage);
  return AgePassAPI.join(providers, makeCompiledAgePass('.'), contractAddress, role, state);
}

export async function deployAs(
  wallet: ConnectedWallet,
  state: AgePassPrivateState,
  onStage: (s: TxStage) => void,
): Promise<AgePassAPI> {
  const keys = await wallet.api.getShieldedAddresses();
  const providers = browserProviders(wallet.api, wallet.config, keys, wallet.proofServer, onStage);
  return AgePassAPI.deploy(providers, makeCompiledAgePass('.'), state, 'admin');
}
