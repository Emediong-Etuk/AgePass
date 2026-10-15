// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// "Try it without a wallet": the whole AgePass story in one page, running the real compiled
// contract circuits in this browser against an in-memory ledger. For judges and visitors who
// have no Lace wallet or test tokens. Clearly labelled as simulated: no proofs are generated
// and nothing is sent to Midnight.

import { useRef, useState } from 'react';
import {
  type AgePassChallenge,
  type AgePassPrivateState,
  ageOn,
  challengeToCircuitArgs,
  computeCommitment,
  computeHolderPk,
  computeIssuerPk,
  computeNym,
  computeSiteId,
  createAgePassPrivateState,
  createChallenge,
  describeError,
  evaluateLedger,
  formatIsoDate,
  parseIsoDate,
  randomBytes32,
  shortHex,
  toHex,
  toYYYYMMDD,
} from '@agepass/sdk';
import { Banner, Card } from '../components/ui';
import { DEMO_STORE } from '../lib/config';
import { href } from '../lib/router';
import { SimulatedAgePass } from '../lib/simulated';

const isoYearsAgo = (years: number): string => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

const inYears = (years: number): bigint => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return toYYYYMMDD(d);
};

type Line = { label: string; value: string; explain?: string };
type Outcome = { ok: boolean; title: string; lines?: Line[]; note?: string };

const STEPS = [
  { title: 'Deploy AgePass', circuit: 'constructor', who: 'Admin' },
  { title: 'Approve a trusted issuer', circuit: 'addIssuer', who: 'Admin' },
  { title: 'Issue credentials to two people', circuit: 'issueCredential ×2', who: 'Issuer' },
  { title: 'Corner Cellar asks: “Are you 18+?”', circuit: 'off-chain request', who: 'Store' },
  { title: 'The adult proves they are 18+', circuit: 'proveAge', who: 'Adult' },
  { title: 'The 16-year-old tries the same store', circuit: 'proveAge', who: 'Minor' },
  { title: 'Someone replays the adult’s answer', circuit: 'proveAge', who: 'Attacker' },
] as const;

const newActors = () => ({
  adminSk: randomBytes32(),
  issuerSk: randomBytes32(),
  adultSk: randomBytes32(),
  minorSk: randomBytes32(),
});

export function TryPage() {
  const [actors, setActors] = useState(newActors);
  const sim = useRef<SimulatedAgePass | undefined>(undefined);
  const challenge = useRef<AgePassChallenge | undefined>(undefined);
  const [adultBirth, setAdultBirth] = useState('1998-04-12');
  const [minorBirth, setMinorBirth] = useState(isoYearsAgo(16));
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const done = outcomes.length;

  const issuerPk = computeIssuerPk(actors.issuerSk);
  const adultPk = computeHolderPk(actors.adultSk);
  const minorPk = computeHolderPk(actors.minorSk);
  const credentialFor = (birthIso: string) => ({
    birthDate: parseIsoDate(birthIso),
    expiresOn: inYears(5),
    issuerPk,
  });
  const holder = (sk: Uint8Array, birthIso: string): AgePassPrivateState =>
    createAgePassPrivateState(sk, credentialFor(birthIso));

  const attempt = (f: () => Outcome): Outcome => {
    try {
      return f();
    } catch (e) {
      const d = describeError(e);
      return { ok: false, title: d.title, note: d.fix };
    }
  };

  const need = (): SimulatedAgePass => {
    if (!sim.current) throw new Error('AgePass: run the earlier steps first');
    return sim.current;
  };
  const needChallenge = (): AgePassChallenge => {
    if (!challenge.current) throw new Error('AgePass: run the earlier steps first');
    return challenge.current;
  };

  const runStep = (i: number): Outcome => {
    switch (i) {
      case 0:
        return attempt(() => {
          sim.current = new SimulatedAgePass(actors.adminSk);
          return {
            ok: true,
            title: 'Contract deployed. Whoever holds the admin secret manages the issuer list.',
            lines: [
              {
                label: 'admin',
                value: shortHex(toHex(sim.current.ledger().admin), 6),
                explain: 'A hash of the admin’s secret, never the secret itself.',
              },
            ],
          };
        });
      case 1:
        return attempt(() => {
          const s = need();
          s.addIssuer(createAgePassPrivateState(actors.adminSk), issuerPk);
          return {
            ok: true,
            title: 'Demo KYC Ltd is now an approved issuer.',
            lines: [
              { label: 'issuer key', value: shortHex(toHex(issuerPk), 6) },
              { label: 'approved issuers', value: String(s.ledger().issuers.size()) },
            ],
          };
        });
      case 2:
        return attempt(() => {
          const s = need();
          const issuer = createAgePassPrivateState(actors.issuerSk);
          const adult = credentialFor(adultBirth);
          const minor = credentialFor(minorBirth);
          s.issueCredential(issuer, adult.birthDate, adult.expiresOn, adultPk);
          s.issueCredential(issuer, minor.birthDate, minor.expiresOn, minorPk);
          return {
            ok: true,
            title: `Credentials issued: adult (age ${ageOn(adult.birthDate)}) and minor (age ${ageOn(minor.birthDate)}).`,
            lines: [
              {
                label: 'on-chain',
                value: shortHex(toHex(computeCommitment(adult, adultPk)), 6),
                explain: 'Only a hiding commitment (a hash) per credential enters the tree.',
              },
              {
                label: 'on-chain',
                value: shortHex(toHex(computeCommitment(minor, minorPk)), 6),
              },
              {
                label: 'never on-chain',
                value: `${adultBirth}, ${minorBirth}`,
                explain: 'The birth dates stay in each person’s wallet.',
              },
            ],
          };
        });
      case 3:
        return attempt(() => {
          const c = createChallenge({
            siteDomain: DEMO_STORE.domain,
            minAge: DEMO_STORE.minAge,
            siteName: DEMO_STORE.name,
          });
          challenge.current = c;
          return {
            ok: true,
            title: 'The store creates a single-use request. Nothing is on-chain yet.',
            lines: [
              { label: 'question', value: `Are you ${c.minAge}+?` },
              {
                label: 'cutoff',
                value: formatIsoDate(c.cutoffDate),
                explain: 'Born on or before this date means 18+.',
              },
              { label: 'challengeId', value: shortHex(c.challengeId, 6) },
            ],
          };
        });
      case 4:
        return attempt(() => {
          const s = need();
          const c = needChallenge();
          s.proveAge(holder(actors.adultSk, adultBirth), challengeToCircuitArgs(c));
          const r = evaluateLedger(c, s.ledger());
          if (r.status !== 'verified') throw new Error('AgePass: the store could not verify');
          const otherSite = computeNym(actors.adultSk, computeSiteId('another-shop.example'));
          return {
            ok: true,
            title: 'Verified. The store unlocks. This is everything it learned:',
            lines: [
              { label: 'challengeId', value: shortHex(c.challengeId, 6) },
              {
                label: 'siteId',
                value: shortHex(toHex(r.record.siteId), 6),
                explain: `Hash of “${DEMO_STORE.domain}”: the answer only counts for this store.`,
              },
              {
                label: 'nym',
                value: shortHex(r.nym, 6),
                explain: `A nickname for this store only. At another shop the same person is ${shortHex(toHex(otherSite), 6)}: unlinkable.`,
              },
              {
                label: 'cutoffDate',
                value: formatIsoDate(r.record.cutoffDate),
                explain: 'Proven: born on or before this. The birth date itself stays private.',
              },
              {
                label: 'checkedOn',
                value: formatIsoDate(r.record.checkedOn),
                explain: 'Proven: the credential had not expired on this day.',
              },
            ],
            note: 'No name, no birth date, no issuer, no link to the credential.',
          };
        });
      case 5:
        return attempt(() => {
          const s = need();
          const before = s.ledger().verificationCount;
          const c = createChallenge({ siteDomain: DEMO_STORE.domain, minAge: DEMO_STORE.minAge });
          try {
            s.proveAge(holder(actors.minorSk, minorBirth), challengeToCircuitArgs(c));
          } catch (e) {
            return {
              ok: true,
              title: 'Blocked on the minor’s own device. Nothing was shared or written.',
              lines: [
                { label: 'reason', value: describeError(e).title },
                {
                  label: 'age checks on-chain',
                  value: `${before} → ${s.ledger().verificationCount}`,
                  explain: 'The failed attempt left no trace on the ledger.',
                },
              ],
            };
          }
          throw new Error('AgePass: the minor was not blocked (unexpected)');
        });
      default:
        return attempt(() => {
          const s = need();
          const c = needChallenge();
          try {
            s.proveAge(holder(actors.adultSk, adultBirth), challengeToCircuitArgs(c));
          } catch (e) {
            return {
              ok: true,
              title: 'Rejected. Every store request can be answered only once.',
              lines: [{ label: 'reason', value: describeError(e).title }],
            };
          }
          throw new Error('AgePass: the replay was accepted (unexpected)');
        });
    }
  };

  // Steps mutate the simulator, so run them here, never inside a state updater.
  const next = () => setOutcomes([...outcomes, runStep(outcomes.length)]);
  const all = () => {
    const out = [...outcomes];
    while (out.length < STEPS.length) out.push(runStep(out.length));
    setOutcomes(out);
  };
  const reset = () => {
    sim.current = undefined;
    challenge.current = undefined;
    setOutcomes([]);
    setActors(newActors());
  };

  const l = sim.current?.ledger();
  return (
    <div className="stack-lg">
      <h1>Try it without a wallet</h1>
      <Banner kind="info">
        <strong>Simulated in your browser.</strong> This runs the real AgePass contract logic (the
        compiled Compact circuits) against an in-memory ledger: every rule is enforced exactly as on
        Midnight. There is no wallet, no fee and no zero-knowledge proof, and nothing leaves this
        page. To see it live on Midnight Preview, watch the demo video or use the{' '}
        <a href={href('/issuer')}>Issuer desk</a> with Lace.
      </Banner>

      <Card title="Two people, demo data only">
        <div className="grid-2">
          <label className="field">
            <span className="label">Adult’s birth date</span>
            <input
              type="date"
              value={adultBirth}
              disabled={done > 2}
              onChange={(e) => setAdultBirth(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">Minor’s birth date</span>
            <input
              type="date"
              value={minorBirth}
              disabled={done > 2}
              onChange={(e) => setMinorBirth(e.target.value)}
            />
          </label>
        </div>
        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={done >= STEPS.length}
            onClick={next}
          >
            {done === 0 ? 'Start: step 1' : done < STEPS.length ? `Run step ${done + 1}` : 'Done'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={done >= STEPS.length}
            onClick={all}
          >
            Run all steps
          </button>
          {done > 0 && (
            <button type="button" className="btn btn-link" onClick={reset}>
              Start over
            </button>
          )}
        </div>
      </Card>

      <ol className="try-steps">
        {STEPS.map((s, i) => {
          const o = outcomes[i];
          return (
            <li key={s.title} className={`card try-step ${o ? 'try-done' : ''}`}>
              <div className="try-head">
                <span className={`pill ${o ? (o.ok ? 'pill-ok' : 'pill-bad') : ''}`}>{i + 1}</span>
                <strong>{s.title}</strong>
                <span className="muted small">
                  {s.who} · <code>{s.circuit}</code>
                </span>
              </div>
              {o && (
                <div className="stack">
                  <p className={o.ok ? '' : 'text-bad'}>{o.title}</p>
                  {o.lines && (
                    <dl className="kv">
                      {o.lines.map((x, j) => (
                        <div className="contents" key={`${x.label}-${j}`}>
                          <dt>{x.label}</dt>
                          <dd className="mono break">{x.value}</dd>
                          {x.explain && <dd className="explain">{x.explain}</dd>}
                        </div>
                      ))}
                    </dl>
                  )}
                  {o.note && <p className="muted small">{o.note}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {l && (
        <Card title="The whole public ledger now">
          <dl className="kv">
            <dt>approved issuers</dt>
            <dd>{String(l.issuers.size())}</dd>
            <dt>credentials issued</dt>
            <dd>{String(l.credentialCount)}</dd>
            <dt>age checks answered</dt>
            <dd>{String(l.verificationCount)}</dd>
          </dl>
          <p className="muted small">
            That is all anyone watching the chain can see: counts, hashes and one record per
            answered request. No names, no birth dates, and no way to tell which credential answered
            which request.
          </p>
        </Card>
      )}
    </div>
  );
}
