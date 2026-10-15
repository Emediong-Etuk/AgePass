// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Browser Midnight.js providers: Lace balances, submits and (when it supports it) proves;
// otherwise a local proof server proves. Keys are fetched from this site, private state
// lives only in memory (see vault.ts).
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
import {
  type ProofProvider,
  type PublicDataProvider,
  type UnboundTransaction,
  type ZKConfigProvider,
  createProofProvider,
} from '@midnight-ntwrk/midnight-js-types';
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

/**
 * Proves through the wallet (DApp Connector `getProvingProvider`) when it offers that, so
 * visitors need no local proof server; falls back to the local proof server if the wallet
 * can't prove and one is reachable.
 */
async function proofProvider(
  wallet: ConnectedWallet,
  zkConfigProvider: ZKConfigProvider<AgePassCircuitId>,
): Promise<ProofProvider> {
  const local = httpClientProofProvider(wallet.proofServer, zkConfigProvider);
  if (!wallet.walletProving) return local;
  try {
    const proving = await wallet.api.getProvingProvider({
      getZKIR: (c) => zkConfigProvider.getZKIR(c as AgePassCircuitId),
      getProverKey: (c) => zkConfigProvider.getProverKey(c as AgePassCircuitId),
      getVerifierKey: (c) => zkConfigProvider.getVerifierKey(c as AgePassCircuitId),
    });
    const viaWallet = createProofProvider(proving);
    return {
      async proveTx(tx, cfg) {
        try {
          return await viaWallet.proveTx(tx, cfg);
        } catch (e) {
          if (wallet.proofServerOk) return local.proveTx(tx, cfg);
          throw e;
        }
      },
    };
  } catch (e) {
    if (wallet.proofServerOk) return local;
    throw e;
  }
}

export async function browserProviders(
  wallet: ConnectedWallet,
  shieldedKeys: { shieldedCoinPublicKey: string; shieldedEncryptionPublicKey: string },
  onStage: (s: TxStage) => void,
): Promise<AgePassProviders> {
  setNetworkId(NETWORK);
  // Lace fails with an empty error when it cannot pay the fee, so say it plainly up front.
  if (wallet.dust === 0n) {
    throw new Error(
      'AgePass: your wallet has no DUST to pay the network fee. Get tNIGHT from the Preview faucet, register it for DUST generation in Lace, wait a few minutes, then press Re-check.',
    );
  }
  const { api, config } = wallet;
  const zkConfigProvider = new FetchZkConfigProvider<AgePassCircuitId>(
    zkAssetsBase(),
    fetch.bind(window),
  );
  const prover = await proofProvider(wallet, zkConfigProvider);
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
  proofServerOk: boolean;
  /** The wallet can prove for us (DApp Connector `getProvingProvider`). */
  walletProving: boolean;
  /** Spendable DUST as the wallet reported it at connect time (undefined if unknown). */
  dust: bigint | undefined;
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
  const providers = await browserProviders(wallet, keys, onStage);
  return AgePassAPI.join(providers, makeCompiledAgePass('.'), contractAddress, role, state);
}

export async function deployAs(
  wallet: ConnectedWallet,
  state: AgePassPrivateState,
  onStage: (s: TxStage) => void,
): Promise<AgePassAPI> {
  const keys = await wallet.api.getShieldedAddresses();
  const providers = await browserProviders(wallet, keys, onStage);
  return AgePassAPI.deploy(providers, makeCompiledAgePass('.'), state, 'admin');
}
