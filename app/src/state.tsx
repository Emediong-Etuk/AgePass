// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// App-wide state: Lace connection, the unlocked vault, and toasts.

import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { NETWORK } from './lib/config';
import { type WalletStatus, connectLace } from './lib/lace';
import type { ConnectedWallet } from './lib/providers';
import { type OpenVault, type VaultData } from './lib/vault';

export type Toast = { id: number; kind: 'ok' | 'error' | 'info'; text: string };

type AppState = {
  wallet: WalletStatus;
  connect(): Promise<void>;
  connected(): ConnectedWallet | undefined;
  vault: OpenVault | undefined;
  setVault(v: OpenVault | undefined): void;
  updateVault(f: (d: VaultData) => VaultData): Promise<void>;
  toasts: Toast[];
  toast(kind: Toast['kind'], text: string): void;
  dismiss(id: number): void;
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletStatus>({ kind: 'idle' });
  const [vault, setVaultState] = useState<OpenVault>();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (kind: Toast['kind'], text: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 5000);
    },
    [dismiss],
  );

  const connect = useCallback(async () => {
    setWallet({ kind: 'connecting' });
    try {
      setWallet(await connectLace(NETWORK));
    } catch (e) {
      setWallet({ kind: 'error', message: (e as Error).message });
    }
  }, []);

  const connected = useCallback((): ConnectedWallet | undefined => {
    if (wallet.kind !== 'connected') return undefined;
    return {
      api: wallet.api,
      config: wallet.config,
      proofServer: wallet.proofServer,
      proofServerOk: wallet.proofServerOk,
      walletProving: wallet.walletProving,
    };
  }, [wallet]);

  const updateVault = useCallback(
    async (f: (d: VaultData) => VaultData) => {
      if (!vault) throw new Error('AgePass: unlock your wallet first');
      const next = f(vault.data);
      await vault.save(next);
      setVaultState({ ...vault, data: next });
    },
    [vault],
  );

  const value = useMemo<AppState>(
    () => ({
      wallet,
      connect,
      connected,
      vault,
      setVault: setVaultState,
      updateVault,
      toasts,
      toast,
      dismiss,
    }),
    [wallet, connect, connected, vault, updateVault, toasts, toast, dismiss],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
