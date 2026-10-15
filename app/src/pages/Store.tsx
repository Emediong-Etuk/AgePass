// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// "Corner Cellar": a fictional age-gated shop. It needs no wallet: it creates a challenge,
// hands off to the holder's wallet, then reads the public record and checks it matches.

import { useEffect, useState } from 'react';
import {
  type AgePassChallenge,
  type VerificationResult,
  createChallenge,
  encodeChallengeForUrl,
  formatIsoDate,
  ledgerReader,
  parseChallenge,
  shortHex,
  toHex,
  waitForVerification,
} from '@agepass/sdk';
import { Banner, Card, ErrorNotice } from '../components/ui';
import { DEMO_STORE, getContractAddress } from '../lib/config';
import { publicDataProvider } from '../lib/providers';
import { href, navigate } from '../lib/router';

const KEY = 'agepass.store.challenge';
const PRODUCTS = [
  { name: 'Highland Single Malt', note: '70 cl · 12 yrs', price: '£48', emoji: '🥃' },
  { name: 'Riverside Pale Ale', note: '6 × 330 ml', price: '£11', emoji: '🍺' },
  { name: 'Valley Pinot Noir', note: '75 cl · 2023', price: '£19', emoji: '🍷' },
  { name: 'Citrus Gin', note: '50 cl', price: '£32', emoji: '🍸' },
];

const load = (): AgePassChallenge | undefined => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? parseChallenge(raw) : undefined;
  } catch {
    return undefined;
  }
};

export function StorePage() {
  const [challenge, setChallenge] = useState(load);
  const [result, setResult] = useState<VerificationResult>();
  const [error, setError] = useState<unknown>();
  const address = getContractAddress();

  useEffect(() => {
    if (!challenge || !address) return;
    const ctl = new AbortController();
    setResult({ status: 'pending' });
    waitForVerification(ledgerReader(publicDataProvider(), address), challenge, {
      intervalMs: 3000,
      timeoutMs: 10 * 60_000,
      signal: ctl.signal,
    }).then(
      (r) => !ctl.signal.aborted && setResult(r),
      (e) => !ctl.signal.aborted && setError(e),
    );
    return () => ctl.abort();
  }, [challenge, address]);

  const verify = () => {
    const c = createChallenge({
      siteDomain: DEMO_STORE.domain,
      minAge: DEMO_STORE.minAge,
      siteName: DEMO_STORE.name,
    });
    sessionStorage.setItem(KEY, JSON.stringify(c));
    // Same-origin hand-off; the request travels in the URL fragment, never to a server.
    navigate('/wallet', { request: encodeChallengeForUrl(c), return: '/store' });
  };

  const reset = () => {
    sessionStorage.removeItem(KEY);
    setChallenge(undefined);
    setResult(undefined);
    setError(undefined);
  };

  const unlocked = result?.status === 'verified';
  return (
    <div className="store">
      <header className="store-head">
        <div>
          <h1>Corner Cellar</h1>
          <p className="muted">A fictional demo store. Nothing is for sale.</p>
        </div>
        {unlocked && (
          <span className="pill pill-ok pill-mono">Welcome, nym {shortHex(result.nym)}</span>
        )}
      </header>

      {!address && (
        <Banner kind="warn">
          No AgePass deployment configured. Set one on the <a href={href('/explorer')}>Explorer</a>{' '}
          page or deploy from the <a href={href('/issuer')}>Issuer desk</a>.
        </Banner>
      )}

      <div className="store-layout">
        <section>
          <div className={`products ${unlocked ? '' : 'locked'}`} aria-hidden={!unlocked}>
            {PRODUCTS.map((p) => (
              <article key={p.name} className="product">
                <div className="product-img" aria-hidden="true">
                  {p.emoji}
                </div>
                <h3>{p.name}</h3>
                <p className="muted small">{p.note}</p>
                <div className="row">
                  <strong>{p.price}</strong>
                  <button type="button" className="btn btn-ghost btn-small" disabled={!unlocked}>
                    Add to basket
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!unlocked && (
            <div className="gate">
              <h2>You must be 18 or older to browse.</h2>
              {!challenge ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!address}
                  onClick={verify}
                >
                  Verify with AgePass
                </button>
              ) : result?.status === 'rejected' ? (
                <Banner kind="error">Verification rejected: {result.message}</Banner>
              ) : (
                <p className="muted">
                  Waiting for your AgePass proof to land on-chain…{' '}
                  <a
                    href={href('/wallet', {
                      request: encodeChallengeForUrl(challenge),
                      return: '/store',
                    })}
                  >
                    Open wallet
                  </a>
                </p>
              )}
              <p className="muted small">
                We never see your ID or birth date. Only “yes” and a nickname for this store.
              </p>
            </div>
          )}
          {error !== undefined && <ErrorNotice error={error} />}
          {challenge && (
            <button type="button" className="btn btn-link small" onClick={reset}>
              Start over with a new request
            </button>
          )}
        </section>

        <aside>
          <Card title="What landed on-chain">
            {result?.status === 'verified' || result?.status === 'rejected' ? (
              <dl className="kv record">
                <dt>challengeId</dt>
                <dd className="mono">{shortHex(challenge?.challengeId ?? '', 6)}</dd>
                <dd className="explain">Random, single-use request id this store generated.</dd>
                <dt>siteId</dt>
                <dd className="mono">{shortHex(toHex(result.record.siteId), 6)}</dd>
                <dd className="explain">
                  Hash of “{DEMO_STORE.domain}”. Proves the proof was made for this store.
                </dd>
                <dt>nym</dt>
                <dd className="mono">{shortHex(toHex(result.record.nym), 6)}</dd>
                <dd className="explain">
                  Your nickname here. Another site gets a different, unlinkable one.
                </dd>
                <dt>cutoffDate</dt>
                <dd>{formatIsoDate(result.record.cutoffDate)}</dd>
                <dd className="explain">
                  Proven: birth date is on or before this. The birth date itself stays private.
                </dd>
                <dt>checkedOn</dt>
                <dd>{formatIsoDate(result.record.checkedOn)}</dd>
                <dd className="explain">Proven: the credential had not expired on this date.</dd>
              </dl>
            ) : challenge ? (
              <>
                <p className="muted small">The store asked:</p>
                <dl className="kv">
                  <dt>Question</dt>
                  <dd>Are you {challenge.minAge}+?</dd>
                  <dt>Cutoff</dt>
                  <dd>born on or before {formatIsoDate(challenge.cutoffDate)}</dd>
                  <dt>Request</dt>
                  <dd className="mono">{shortHex(challenge.challengeId, 6)}</dd>
                </dl>
                <p className="muted small">
                  The store checks the on-chain record matches every one of these values.
                </p>
              </>
            ) : (
              <p className="muted small">
                After you verify, this panel shows the exact public record, field by field.
              </p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
