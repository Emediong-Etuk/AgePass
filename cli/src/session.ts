// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// A CLI session = one fee wallet + one set of Midnight.js providers. Several AgePass roles
// (admin, issuer, holders) can act through the same session, each under its own
// private-state id in the encrypted level store.

import path from 'node:path';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import {
  AgePassAPI,
  type AgePassCircuitId,
  type AgePassPrivateState,
  type AgePassProviders,
  type CompiledAgePass,
  type Ledger,
  assertStrongPassword,
  makeCompiledAgePass,
  readLedger,
} from '@agepass/sdk';
import { type CliConfig, STATE_DIR, ZK_ASSETS_PATH, assertZkAssetsBuilt } from './config.js';
import type { Log } from './log.js';
import {
  type WalletContext,
  ensureFeesReady,
  startWallet,
  stopWallet,
  walletProviders,
} from './wallet.js';

/** Read-only access to the public ledger: needs only the indexer, no wallet. */
export function publicData(config: CliConfig): PublicDataProvider {
  setNetworkId(config.networkId);
  return indexerPublicDataProvider(config.indexer, config.indexerWS);
}

export async function readLedgerOrThrow(config: CliConfig, address: string): Promise<Ledger> {
  const l = await readLedger(publicData(config), address);
  if (l === null)
    throw new Error(`AgePass: no AgePass contract at ${address} on ${config.networkId}`);
  return l;
}

export type Session = {
  readonly providers: AgePassProviders;
  readonly compiled: CompiledAgePass;
  readonly wallet: WalletContext;
  /** Transactions handed to the network so far (proof that failed checks submit nothing). */
  submittedCount(): number;
  deploy(adminState: AgePassPrivateState, privateStateId: string): Promise<AgePassAPI>;
  join(address: string, privateStateId: string, state?: AgePassPrivateState): Promise<AgePassAPI>;
  close(): Promise<void>;
};

export async function openSession(
  config: CliConfig,
  log: Log,
  opts: { storagePassword: string; storeName?: string },
): Promise<Session> {
  assertZkAssetsBuilt();
  assertStrongPassword(opts.storagePassword);
  setNetworkId(config.networkId);

  const wallet = await startWallet(config, config.walletSeed);
  await ensureFeesReady(wallet, log);

  const zkConfigProvider = new NodeZkConfigProvider<AgePassCircuitId>(ZK_ASSETS_PATH);
  const walletProvider = walletProviders(wallet);
  let submitted = 0;
  const providers: AgePassProviders = {
    privateStateProvider: levelPrivateStateProvider<string, AgePassPrivateState>({
      midnightDbName: path.join(STATE_DIR, `level-${config.networkId}`),
      privateStateStoreName: opts.storeName ?? 'agepass-private-state',
      privateStoragePasswordProvider: () => opts.storagePassword,
      accountId: wallet.unshieldedKeystore.getBech32Address().asString(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: {
      submitTx: (tx) => {
        submitted += 1;
        return walletProvider.submitTx(tx);
      },
    },
  };
  const compiled = makeCompiledAgePass(ZK_ASSETS_PATH);

  return {
    providers,
    compiled,
    wallet,
    submittedCount: () => submitted,
    deploy: (adminState, id) => AgePassAPI.deploy(providers, compiled, adminState, id),
    join: (address, id, state) => AgePassAPI.join(providers, compiled, address, id, state),
    close: () => stopWallet(wallet),
  };
}

/** Checks the proof server answers before we try to prove anything. */
export async function assertProofServer(config: CliConfig): Promise<void> {
  try {
    const res = await fetch(new URL('/version', config.proofServer), {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(
      `AgePass: proof server not reachable at ${config.proofServer} (${(e as Error).message}). Start it with "npm run devnet:up".`,
    );
  }
}
