// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Small shared UI pieces: logo, notices, copy fields, QR codes, toasts, progress.

import { type ReactNode, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { describeError } from '@agepass/sdk';
import { useApp } from '../state';
import type { TxStage } from '../lib/providers';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M16 2 4 6.5v8.2C4 22.3 9.1 28.4 16 30c6.9-1.6 12-7.7 12-15.3V6.5Z"
        fill="var(--navy-2)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <path
        d="m10.5 16.2 3.8 3.8 7.4-7.6"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Card({
  title,
  children,
  className = '',
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title && <h2 className="card-title">{title}</h2>}
      {children}
    </section>
  );
}

export function Banner({
  kind,
  children,
}: {
  kind: 'warn' | 'info' | 'ok' | 'error';
  children: ReactNode;
}) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** Plain-language error with an optional fix and a collapsed technical detail. */
export function ErrorNotice({ error }: { error: unknown }) {
  const f = describeError(error);
  return (
    <div className="banner banner-error" role="alert">
      <strong>{f.title}</strong>
      {f.fix && <div>{f.fix}</div>}
      {f.nothingShared && <div className="muted">Nothing was shared or sent to the network.</div>}
      <details>
        <summary>Details</summary>
        <code className="mono small break">{f.detail}</code>
      </details>
    </div>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const { toast } = useApp();
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="copy">
        <code className="mono break">{value}</code>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() =>
            navigator.clipboard
              .writeText(value)
              .then(() => toast('ok', `${label} copied`))
              .catch(() => toast('error', 'Copy failed: select the text instead'))
          }
        >
          Copy
        </button>
      </div>
    </div>
  );
}

export function Qr({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 220, color: { dark: '#0b1530', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(undefined));
  }, [value]);
  return src ? (
    <img className="qr" src={src} alt={`QR code: ${label}`} width={220} height={220} />
  ) : null;
}

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

const STAGES: { id: TxStage; label: string }[] = [
  { id: 'preparing', label: 'Preparing proof (checking locally)' },
  { id: 'proving', label: 'Generating zero-knowledge proof (can take ~30–60 s)' },
  { id: 'balancing', label: 'Approve the fee in Lace' },
  { id: 'submitting', label: 'Submitting' },
  { id: 'confirmed', label: 'Confirmed' },
];

export function TxProgress({ stage, startedAt }: { stage: TxStage; startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (stage === 'confirmed') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [stage]);
  const current = STAGES.findIndex((s) => s.id === stage);
  return (
    <div className="progress" role="status" aria-live="polite">
      <ol>
        {STAGES.map((s, i) => (
          <li
            key={s.id}
            className={
              i < current || stage === 'confirmed' ? 'done' : i === current ? 'active' : ''
            }
          >
            <span className="dot" aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ol>
      <div className="muted small">Elapsed {((now - startedAt) / 1000).toFixed(0)} s</div>
    </div>
  );
}
