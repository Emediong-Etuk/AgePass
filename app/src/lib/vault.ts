// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// The on-device vault: holder/issuer/admin secrets and the holder's credential, encrypted
// with a passphrase (PBKDF2-SHA256 600k → AES-GCM-256) before touching localStorage. The
// passphrase must pass the same policy Midnight.js uses for private-state storage.

import { assertStrongPassword, fromHex, toHex } from '@agepass/sdk';

export type VaultCredential = {
  readonly birthDate: number; // YYYYMMDD
  readonly expiresOn: number; // YYYYMMDD
  readonly issuerPk: string;
  readonly issuerName: string;
  readonly contractAddress: string;
  readonly commitment: string;
  readonly importedAt: string;
};

export type VaultData = {
  holder?: { sk: string; credential?: VaultCredential };
  issuer?: { sk: string; name: string };
  admin?: { sk: string };
};

type Sealed = { v: 1; salt: string; iv: string; data: string };

const KEY = 'agepass.vault.v1';
const ITERATIONS = 600_000;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export const vaultExists = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
};

export type OpenVault = { data: VaultData; save(next: VaultData): Promise<void> };

async function open(key: CryptoKey, salt: Uint8Array, data: VaultData): Promise<OpenVault> {
  const save = async (next: VaultData) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(next)),
    );
    const sealed: Sealed = {
      v: 1,
      salt: toHex(salt),
      iv: toHex(iv),
      data: toHex(new Uint8Array(ct)),
    };
    localStorage.setItem(KEY, JSON.stringify(sealed));
  };
  return { data, save };
}

export async function createVault(passphrase: string): Promise<OpenVault> {
  assertStrongPassword(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const v = await open(await deriveKey(passphrase, salt), salt, {});
  await v.save({});
  return v;
}

export async function unlockVault(passphrase: string): Promise<OpenVault> {
  const raw = localStorage.getItem(KEY);
  if (raw === null) throw new Error('AgePass: no AgePass wallet on this device yet');
  const sealed = JSON.parse(raw) as Sealed;
  const salt = fromHex(sealed.salt);
  const key = await deriveKey(passphrase, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromHex(sealed.iv) as BufferSource },
      key,
      fromHex(sealed.data) as BufferSource,
    );
  } catch {
    throw new Error('AgePass: wrong passphrase');
  }
  return open(key, salt, JSON.parse(new TextDecoder().decode(plain)) as VaultData);
}

/** Irreversibly removes the vault from this device. */
export function destroyVault(): void {
  localStorage.removeItem(KEY);
}
