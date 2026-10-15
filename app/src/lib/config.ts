// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Which network and which AgePass deployment the app talks to. Build-time defaults come from
// VITE_* variables; testers can point the app at another deployment from the Explorer page.

import { type AgePassNetwork, isAgePassNetwork, networkConfig } from '@agepass/sdk';

const env = import.meta.env as Record<string, string | undefined>;

export const NETWORK: AgePassNetwork = isAgePassNetwork(env.VITE_NETWORK_ID)
  ? env.VITE_NETWORK_ID
  : 'preview';

/**
 * Public endpoints for read-only views (explorer, store polling), so they work without a
 * wallet. Preprod's indexer needs a Blockfrost token, which must never ship in a static
 * site, so the web app targets `preview` (or `undeployed` for local work).
 */
export const PUBLIC_ENDPOINTS = networkConfig(NETWORK === 'undeployed' ? 'undeployed' : 'preview');

const STORAGE_KEY = `agepass.contract.${NETWORK}`;

/** The public AgePass deployment on Preview (Wave 1), used when nothing else is configured. */
export const PREVIEW_DEPLOYMENT =
  '54fc78d8890099e24fdf91f4a4f72cb231659393ee5264462b4496b9221069d2';

const defaultAddress = (): string | undefined =>
  env.VITE_AGEPASS_CONTRACT ?? (NETWORK === 'preview' ? PREVIEW_DEPLOYMENT : undefined);

export function getContractAddress(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? defaultAddress();
  } catch {
    return defaultAddress();
  }
}

export function setContractAddress(address: string | undefined): void {
  try {
    if (address) localStorage.setItem(STORAGE_KEY, address.trim());
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): the build-time default still applies.
  }
}

/** The demo store's identity. Fixed so the CLI demo and the web demo produce the same site id. */
export const DEMO_STORE = {
  domain: 'cornercellar.example',
  name: 'Corner Cellar (demo store)',
  minAge: 18,
} as const;

/** Base URL that serves keys/ and zkir/ (works under sub-paths like GitHub Pages). */
export const zkAssetsBase = (): string =>
  new URL(import.meta.env.BASE_URL, window.location.href).href;
