// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Create or unlock the on-device vault before showing anything that needs secrets.

import { type FormEvent, type ReactNode, useState } from 'react';
import { PASSWORD_HINT, PASSWORD_RULES, passwordProblem } from '@agepass/sdk';
import { useApp } from '../state';
import { createVault, destroyVault, unlockVault, vaultExists } from '../lib/vault';
import { Card, ErrorNotice } from './ui';

export function VaultGate({ children, intro }: { children: ReactNode; intro: ReactNode }) {
  const { vault, setVault, toast } = useApp();
  const [exists, setExists] = useState(vaultExists);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  if (vault) return <>{children}</>;

  const problem = pass.length > 0 ? passwordProblem(pass) : null;
  // Live check that the repeat field matches, so a typo is caught before the wallet exists.
  const mismatch = !exists && confirm.length > 0 && confirm !== pass;
  const matches = !exists && confirm.length > 0 && confirm === pass;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (exists) {
        setVault(await unlockVault(pass));
        toast('ok', 'Wallet unlocked');
      } else {
        if (pass !== confirm) throw new Error('AgePass: the two passphrases do not match');
        setVault(await createVault(pass));
        toast('ok', 'AgePass wallet created on this device');
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={exists ? 'Unlock your AgePass wallet' : 'Create your AgePass wallet'}>
      {intro}
      <form onSubmit={(e) => void submit(e)} className="stack">
        <div className="field">
          <label className="label" htmlFor="vault-pass">
            Passphrase
          </label>
          <input
            id="vault-pass"
            type="password"
            autoComplete={exists ? 'current-password' : 'new-password'}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            aria-describedby="pass-hint"
            required
          />
          <span id="pass-hint" className={`small ${problem ? 'text-warn' : 'muted'}`}>
            {exists
              ? 'The passphrase you chose when you created this wallet.'
              : problem
                ? PASSWORD_RULES[problem]
                : PASSWORD_HINT}
          </span>
        </div>
        {!exists && (
          <div className="field">
            <label className="label" htmlFor="vault-confirm">
              Repeat passphrase
            </label>
            <input
              id="vault-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-describedby="confirm-hint"
              aria-invalid={mismatch}
              required
            />
            <span
              id="confirm-hint"
              className={`small ${mismatch ? 'text-bad' : matches ? 'accent' : 'muted'}`}
              aria-live="polite"
            >
              {mismatch
                ? 'Passphrases don’t match yet.'
                : matches
                  ? '✓ Passphrases match.'
                  : 'Type the same passphrase again.'}
            </span>
          </div>
        )}
        <button
          className="btn btn-primary"
          disabled={busy || (!exists && (problem !== null || confirm !== pass))}
        >
          {busy ? 'Working…' : exists ? 'Unlock' : 'Create wallet'}
        </button>
        <p className="muted small">
          Your keys are encrypted with this passphrase and stay in this browser. AgePass has no
          server and cannot recover them.
        </p>
      </form>
      {error !== undefined && <ErrorNotice error={error} />}
      {exists && (
        <button
          type="button"
          className="btn btn-link small"
          onClick={() => {
            if (
              window.confirm(
                'Delete the AgePass wallet on this device? Your credential will be lost.',
              )
            ) {
              destroyVault();
              setExists(false);
            }
          }}
        >
          Forgot passphrase? Reset this device
        </button>
      )}
    </Card>
  );
}
