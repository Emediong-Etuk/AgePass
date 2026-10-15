// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Lace via the Midnight DApp Connector API 4.x. Each failure mode a tester can hit is
// detected separately so the UI can give a one-line fix instead of a generic error.

import type { ConnectedAPI, Configuration, InitialAPI } from '@midnight-ntwrk/dapp-connector-api';
import semver from 'semver';
import { DEFAULT_PROOF_SERVER } from '@agepass/sdk';

export type WalletStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'not-installed' }
  | { kind: 'rejected' }
  | { kind: 'wrong-network'; expected: string; actual?: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'connected';
      api: ConnectedAPI;
      config: Configuration;
      walletName: string;
      dust: bigint;
      proofServer: string;
      proofServerOk: boolean;
      /** Lace proves for us, so no local proof server is needed. */
      walletProving: boolean;
    };

export const STATUS_HELP: Record<WalletStatus['kind'], string> = {
  idle: 'Connect Lace to sign transactions.',
  connecting: 'Waiting for Lace… approve the connection in the extension.',
  'not-installed': 'Install the Lace wallet extension for Chrome, then reload this page.',
  rejected: 'Connection declined. Click Connect and approve AgePass in Lace.',
  'wrong-network':
    'Switch Lace to the right Midnight network (Settings » Network), then reconnect.',
  error: 'Lace could not connect. Unlock Lace, wait for it to finish syncing, and retry.',
  connected: 'Lace connected.',
};

const COMPATIBLE = '4.x';

function findWallet(): InitialAPI | undefined {
  const injected = window.midnight;
  if (!injected) return undefined;
  return Object.values(injected).find(
    (w): w is InitialAPI =>
      !!w &&
      typeof w === 'object' &&
      'apiVersion' in w &&
      semver.satisfies(w.apiVersion, COMPATIBLE),
  );
}

/** Extensions inject asynchronously; give them a moment before declaring "not installed". */
async function waitForWallet(ms = 1500): Promise<InitialAPI | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const w = findWallet();
    if (w || Date.now() > deadline) return w;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function proofServerReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(new URL('/version', url), { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function connectLace(networkId: string): Promise<WalletStatus> {
  const initial = await waitForWallet();
  if (!initial) return { kind: 'not-installed' };
  let api: ConnectedAPI;
  try {
    api = await initial.connect(networkId);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'Rejected' || err.code === 'PermissionRejected') return { kind: 'rejected' };
    if (/network/i.test(err.message ?? '')) return { kind: 'wrong-network', expected: networkId };
    return { kind: 'error', message: err.message ?? String(e) };
  }
  const status = await api.getConnectionStatus();
  if (status.status === 'connected' && status.networkId !== networkId) {
    return { kind: 'wrong-network', expected: networkId, actual: status.networkId };
  }
  const config = await api.getConfiguration();
  if (config.networkId !== networkId) {
    return { kind: 'wrong-network', expected: networkId, actual: config.networkId };
  }
  const proofServer = config.proverServerUri ?? DEFAULT_PROOF_SERVER;
  const [dust, proofServerOk] = await Promise.all([
    api
      .getDustBalance()
      .then((d) => d.balance)
      .catch(() => 0n),
    proofServerReachable(proofServer),
  ]);
  return {
    kind: 'connected',
    api,
    config,
    walletName: initial.name,
    dust,
    proofServer,
    proofServerOk,
    walletProving: typeof api.getProvingProvider === 'function',
  };
}

/** True when transactions can be proved: by the wallet itself or a local proof server. */
export const canProve = (w: { walletProving: boolean; proofServerOk: boolean }): boolean =>
  w.walletProving || w.proofServerOk;
