// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// The public AgePass ledger rendered for humans: everything here is visible to everyone.

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { type Ledger, formatIsoDate, readLedger, shortHex, toHex } from '@agepass/sdk';
import { Card, ErrorNotice } from '../components/ui';
import { NETWORK, PUBLIC_ENDPOINTS, getContractAddress, setContractAddress } from '../lib/config';
import { publicDataProvider } from '../lib/providers';
import { useApp } from '../state';

export function ExplorerPage() {
  const { toast } = useApp();
  const [address, setAddress] = useState(getContractAddress() ?? '');
  const [draft, setDraft] = useState(address);
  const [ledger, setLedger] = useState<Ledger | null>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(undefined);
    try {
      setLedger(await readLedger(publicDataProvider(), address));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => void load(), [load]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    setContractAddress(draft || undefined);
    setAddress(draft);
    toast('info', 'Deployment updated');
  };

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1>Public explorer</h1>
        <p className="muted">
          Everything below is public on Midnight <code>{NETWORK}</code>. Notice what is missing: no
          names, no birth dates, no link between a credential and a verification.
        </p>
      </header>

      <Card title="Deployment">
        <form className="row-wrap" onSubmit={save}>
          <input
            className="mono grow"
            value={draft}
            onChange={(e) => setDraft(e.target.value.trim())}
            placeholder="AgePass contract address"
            aria-label="Contract address"
          />
          <button className="btn btn-ghost">Use this deployment</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void load()}
            disabled={loading || !address}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </form>
        <p className="muted small">Indexer: {PUBLIC_ENDPOINTS.indexer}</p>
      </Card>

      {error !== undefined && <ErrorNotice error={error} />}
      {ledger === null && (
        <ErrorNotice
          error={new Error(`AgePass: no AgePass contract at ${address} on ${NETWORK}`)}
        />
      )}

      {ledger && (
        <>
          <section className="grid-3 stats">
            <div className="card stat">
              <span className="stat-n">{ledger.issuers.size().toString()}</span>
              <span className="muted">approved issuers</span>
            </div>
            <div className="card stat">
              <span className="stat-n">{ledger.credentialCount.toString()}</span>
              <span className="muted">credentials issued</span>
            </div>
            <div className="card stat">
              <span className="stat-n">{ledger.verificationCount.toString()}</span>
              <span className="muted">age checks answered</span>
            </div>
          </section>

          <Card title="Admin and issuers">
            <dl className="kv">
              <dt>admin</dt>
              <dd className="mono break">{toHex(ledger.admin)}</dd>
              <dd className="explain">
                Hash of the deployer’s secret. Only its holder can approve or remove issuers.
              </dd>
              {[...ledger.issuers].map((pk, i) => (
                <div key={toHex(pk)} className="contents">
                  <dt>issuer {i + 1}</dt>
                  <dd className="mono break">{toHex(pk)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Credentials">
            <p>
              {ledger.credentialCount.toString()} commitments live in a depth-16 Merkle tree
              (capacity 65,536). The chain stores only leaf hashes; a proof shows that <em>some</em>{' '}
              leaf is yours without saying which.
            </p>
            <p className="muted small mono break">
              current root: {ledger.credentials.root().field.toString(16)}
            </p>
          </Card>

          <Card title="Verification records">
            {ledger.verifications.isEmpty() ? (
              <p className="muted">No age checks answered yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">challenge</th>
                      <th scope="col">site</th>
                      <th scope="col">nym</th>
                      <th scope="col">born on/before</th>
                      <th scope="col">checked on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...ledger.verifications].map(([id, v]) => (
                      <tr key={toHex(id)}>
                        <td className="mono">{shortHex(id)}</td>
                        <td className="mono">{shortHex(v.siteId)}</td>
                        <td className="mono">{shortHex(v.nym)}</td>
                        <td>{formatIsoDate(v.cutoffDate)}</td>
                        <td>{formatIsoDate(v.checkedOn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
