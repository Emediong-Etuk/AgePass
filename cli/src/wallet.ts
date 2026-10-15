// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Headless fee-paying wallet for the CLI (wallet SDK 1.2.0). This wallet only pays DUST
// fees; it is unrelated to anyone's AgePass identity, which lives in AgePass private state.

import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  DustWallet,
  HDWallet,
  InMemoryTransactionHistoryStorage,
  PublicKey as UnshieldedPublicKey,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
  createKeystore,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk';
import { fromHex, type NetworkConfig } from '@agepass/sdk';
import type { Log } from './log.js';

// The indexer client uses the global WebSocket; Node 22 needs the `ws` implementation.
(globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;

export type WalletContext = {
  readonly wallet: WalletFacade;
  readonly shieldedSecretKeys: ledger.ZswapSecretKeys;
  readonly dustSecretKey: ledger.DustSecretKey;
  readonly unshieldedKeystore: UnshieldedKeystore;
};

export async function startWallet(config: NetworkConfig, hexSeed: string): Promise<WalletContext> {
  const hd = HDWallet.fromSeed(fromHex(hexSeed, undefined, 'wallet seed'));
  if (hd.type !== 'seedOk') throw new Error('AgePass: the wallet seed is not valid');
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('AgePass: could not derive wallet keys');
  hd.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(
    derived.keys[Roles.NightExternal],
    config.networkId as Parameters<typeof createKeystore>[1],
  );

  const relayURL = new URL(config.node.replace(/^http/, 'ws'));
  const indexerClientConnection = {
    indexerHttpUrl: config.indexer,
    indexerWsUrl: config.indexerWS,
  };
  const history = () => new InMemoryTransactionHistoryStorage(WalletEntrySchema);
  const shieldedConfig = {
    networkId: config.networkId,
    indexerClientConnection,
    provingServerUrl: new URL(config.proofServer),
    relayURL,
    txHistoryStorage: history(),
  };
  const unshieldedConfig = {
    networkId: config.networkId,
    indexerClientConnection,
    txHistoryStorage: history(),
  };
  const dustConfig = {
    networkId: config.networkId,
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
    indexerClientConnection,
    provingServerUrl: new URL(config.proofServer),
    relayURL,
    txHistoryStorage: history(),
  };

  const wallet = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: () => ShieldedWallet(shieldedConfig).startWithSecretKeys(shieldedSecretKeys),
    unshielded: () =>
      UnshieldedWallet(unshieldedConfig).startWithPublicKey(
        UnshieldedPublicKey.fromKeyStore(unshieldedKeystore),
      ),
    dust: () =>
      DustWallet(dustConfig).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      ),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

const nightBalance = (s: { unshielded?: { balances: Record<string, bigint> } }) =>
  s.unshielded?.balances[ledger.nativeToken().raw] ?? 0n;

/** Address plus balances once synced. Used by `agepass wallet` to check faucet funding. */
export async function walletSummary(
  ctx: WalletContext,
  opts: { waitForNight?: boolean } = {},
): Promise<{ address: string; night: bigint; dust: bigint }> {
  // With waitForNight, block until faucet funds arrive (useful right after requesting them).
  const s = await Rx.firstValueFrom(
    ctx.wallet
      .state()
      .pipe(Rx.filter((x) => x.isSynced && (!opts.waitForNight || nightBalance(x) > 0n))),
  );
  return {
    address: ctx.unshieldedKeystore.getBech32Address().asString(),
    night: nightBalance(s),
    dust: s.dust?.balance(new Date()) ?? 0n,
  };
}

/**
 * Waits for sync, then makes sure the wallet can pay fees: NIGHT must be registered for
 * DUST generation, and some DUST must have accrued. Submissions fail mid-sync or without DUST.
 */
export async function ensureFeesReady(ctx: WalletContext, log: Log): Promise<void> {
  log.step('Syncing fee wallet');
  const synced = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const night = nightBalance(synced);
  const dust = synced.dust?.balance(new Date()) ?? 0n;
  log.info(`Fee wallet ${ctx.unshieldedKeystore.getBech32Address().asString()}`);
  log.info(`NIGHT ${night}, DUST ${dust}`);
  if (dust > 0n) return;
  if (night === 0n) {
    throw new Error(
      'AgePass: the fee wallet has no NIGHT and no DUST. Fund it from the faucet, then register it for DUST.',
    );
  }
  const unregistered =
    synced.unshielded?.availableCoins.filter((c) => !c.meta.registeredForDustGeneration) ?? [];
  if (unregistered.length > 0) {
    log.step(`Registering ${unregistered.length} NIGHT UTXO(s) for DUST generation`);
    const recipe = await ctx.wallet.registerNightUtxosForDustGeneration(
      unregistered,
      ctx.unshieldedKeystore.getPublicKey(),
      (payload) => ctx.unshieldedKeystore.signData(payload),
    );
    await ctx.wallet.submitTransaction(await ctx.wallet.finalizeRecipe(recipe));
  }
  log.step('Waiting for DUST to accrue');
  await Rx.firstValueFrom(
    ctx.wallet
      .state()
      .pipe(Rx.filter((s) => s.isSynced && (s.dust?.balance(new Date()) ?? 0n) > 0n)),
  );
}

export function walletProviders(ctx: WalletContext): WalletProvider & MidnightProvider {
  return {
    getCoinPublicKey: () => ctx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => ctx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: UnboundTransaction, ttl?: Date): Promise<ledger.FinalizedTransaction> {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60_000) },
      );
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: ledger.FinalizedTransaction) => ctx.wallet.submitTransaction(tx),
  };
}

export async function stopWallet(ctx: WalletContext): Promise<void> {
  try {
    await ctx.wallet.stop();
  } catch {
    // Shutting down; nothing useful to report.
  }
}
