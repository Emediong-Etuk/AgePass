// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Lace connection status with a one-line fix for each known problem.

import { NETWORK } from '../lib/config';
import { STATUS_HELP } from '../lib/lace';
import { useApp } from '../state';

export function WalletBar({ purpose }: { purpose: string }) {
  const { wallet, connect } = useApp();

  if (wallet.kind === 'connected') {
    const problems: string[] = [];
    if (!wallet.proofServerOk) {
      problems.push(
        `Proof server not reachable at ${wallet.proofServer}. Start it: docker run -p 6300:6300 midnightntwrk/proof-server:8.1.3 midnight-proof-server -v`,
      );
    }
    if (wallet.dust === 0n) {
      problems.push(
        'No DUST to pay fees. Get tNIGHT from the Preview faucet, then register it for DUST generation in Lace.',
      );
    }
    return (
      <div className={`walletbar ${problems.length ? 'walletbar-warn' : 'walletbar-ok'}`}>
        <div>
          <strong>{wallet.walletName}</strong> connected to <code>{NETWORK}</code>
          {problems.length === 0 && (
            <span className="muted"> · proof server OK · DUST available</span>
          )}
        </div>
        {problems.map((p) => (
          <div key={p} className="small">
            ⚠ {p}
          </div>
        ))}
        {problems.length > 0 && (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void connect()}>
            Re-check
          </button>
        )}
        <div className="muted small">
          If a submission fails right after opening Lace, wait for Lace to finish syncing and retry.
        </div>
      </div>
    );
  }

  const detail =
    wallet.kind === 'wrong-network'
      ? `Lace is on ${wallet.actual ?? 'another network'}; AgePass uses ${wallet.expected}. ${STATUS_HELP['wrong-network']}`
      : wallet.kind === 'error'
        ? `${STATUS_HELP.error} (${wallet.message})`
        : STATUS_HELP[wallet.kind];

  return (
    <div className="walletbar">
      <div>
        <strong>Lace wallet</strong> <span className="muted">· needed to {purpose}</span>
      </div>
      <div className="small">{detail}</div>
      <button
        type="button"
        className="btn btn-primary btn-small"
        disabled={wallet.kind === 'connecting'}
        onClick={() => void connect()}
      >
        {wallet.kind === 'connecting' ? 'Connecting…' : 'Connect Lace'}
      </button>
    </div>
  );
}
