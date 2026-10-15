// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory

import { href } from '../lib/router';
import { Logo } from '../components/ui';

function FlowDiagram() {
  // Three actors, one chain. Only the dashed "proof" line carries data on-chain, and it is a
  // yes plus a per-site nickname.
  return (
    <svg
      className="diagram"
      viewBox="0 0 720 220"
      role="img"
      aria-labelledby="flow-title flow-desc"
    >
      <title id="flow-title">How AgePass works</title>
      <desc id="flow-desc">
        An issuer checks your ID once and records a hidden commitment on Midnight. Later your device
        sends a zero-knowledge proof to Midnight, and the site reads only yes plus a site-specific
        nickname.
      </desc>
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 10 5 0 10z" fill="var(--accent)" />
        </marker>
      </defs>
      {[
        { x: 20, label: 'Issuer', sub: 'bank · telco · KYC' },
        { x: 270, label: 'Midnight', sub: 'public + private ledger' },
        { x: 520, label: 'Site', sub: 'shop · game · app' },
      ].map((b) => (
        <g key={b.label}>
          <rect
            x={b.x}
            y="20"
            width="180"
            height="70"
            rx="14"
            fill="var(--navy-2)"
            stroke="var(--line)"
          />
          <text x={b.x + 90} y="52" textAnchor="middle" className="svg-strong">
            {b.label}
          </text>
          <text x={b.x + 90} y="74" textAnchor="middle" className="svg-muted">
            {b.sub}
          </text>
        </g>
      ))}
      <rect
        x="270"
        y="140"
        width="180"
        height="62"
        rx="14"
        fill="var(--navy-2)"
        stroke="var(--accent)"
      />
      <text x="360" y="168" textAnchor="middle" className="svg-strong">
        Your device
      </text>
      <text x="360" y="188" textAnchor="middle" className="svg-muted">
        secret key + credential
      </text>
      <line
        x1="200"
        y1="55"
        x2="266"
        y2="55"
        stroke="var(--accent)"
        strokeWidth="2"
        markerEnd="url(#arrow)"
      />
      <text x="233" y="45" textAnchor="middle" className="svg-small">
        1 commit
      </text>
      <line
        x1="360"
        y1="138"
        x2="360"
        y2="94"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeDasharray="6 5"
        markerEnd="url(#arrow)"
      />
      <text x="372" y="120" className="svg-small">
        2 ZK proof
      </text>
      <line
        x1="450"
        y1="55"
        x2="516"
        y2="55"
        stroke="var(--accent)"
        strokeWidth="2"
        markerEnd="url(#arrow)"
      />
      <text x="483" y="45" textAnchor="middle" className="svg-small">
        3 “yes”
      </text>
    </svg>
  );
}

export function Landing() {
  return (
    <div className="stack-lg">
      <section className="hero">
        <Logo size={56} />
        <h1>
          Prove you’re 18+.
          <br />
          <span className="accent">Not who you are.</span>
        </h1>
        <p className="lead">
          Age checks today mean uploading your passport to every site. AgePass lets you verify once
          with a trusted issuer, then answer “are you 18?” anywhere with a zero-knowledge proof on
          Midnight.
        </p>
        <div className="row-wrap">
          <a className="btn btn-primary" href={href('/try')}>
            Try it without a wallet
          </a>
          <a className="btn btn-ghost" href={href('/store')}>
            Demo store (with Lace)
          </a>
          <a className="btn btn-ghost" href={href('/wallet')}>
            Open my wallet
          </a>
        </div>
      </section>

      <section className="grid-2">
        <div className="card learn">
          <h2 className="card-title">What sites learn</h2>
          <ul className="ticks">
            <li>Yes, this person meets the age requirement</li>
            <li>
              A private nickname that only works on <em>their</em> site
            </li>
            <li>The date they asked</li>
          </ul>
        </div>
        <div className="card never">
          <h2 className="card-title">What they never learn</h2>
          <ul className="crosses">
            <li>Your name, birth date or ID document</li>
            <li>Which credential is yours</li>
            <li>Your activity on any other site</li>
          </ul>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">How it works</h2>
        <FlowDiagram />
        <ol className="steps">
          <li>
            <strong>Verify once.</strong> An issuer checks your ID one time and records a hidden
            commitment in a Merkle tree on Midnight. The commitment reveals nothing about you.
          </li>
          <li>
            <strong>Prove anywhere.</strong> When a site asks, your device proves in zero knowledge
            that you hold an issued credential, that it is unexpired, and that your birth date is on
            or before the site’s cutoff.
          </li>
          <li>
            <strong>Site learns “yes”.</strong> The public record holds the site, the dates it asked
            about and a nickname that is stable for that site but unlinkable across sites.
          </li>
        </ol>
      </section>

      <section className="grid-3">
        <a className="card tile" href={href('/issuer')}>
          <h3>Issuer desk</h3>
          <p className="muted">DEMO KYC: approve issuers, issue a credential to a holder key.</p>
        </a>
        <a className="card tile" href={href('/wallet')}>
          <h3>Holder wallet</h3>
          <p className="muted">Create your key, import a credential, approve age requests.</p>
        </a>
        <a className="card tile" href={href('/store')}>
          <h3>Corner Cellar</h3>
          <p className="muted">A fictional age-gated shop that asks “18+?” and unlocks.</p>
        </a>
        <a className="card tile" href={href('/explorer')}>
          <h3>Public explorer</h3>
          <p className="muted">
            See exactly what is on-chain: issuers, counts, verification records.
          </p>
        </a>
      </section>
    </div>
  );
}
