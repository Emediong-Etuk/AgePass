// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// DEMO issuer desk. In production this is a KYC provider, bank or telco that already checks
// IDs. It never accepts or stores ID images: the operator types a birth date they verified.

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  type CredentialReceipt,
  type Ledger,
  computeAdminPk,
  computeCommitment,
  computeIssuerPk,
  createAgePassPrivateState,
  createReceipt,
  fromHex,
  parseIsoDate,
  randomBytes32,
  readLedger,
  toHex,
} from '@agepass/sdk';
import { Banner, Card, CopyField, ErrorNotice, Qr, TxProgress } from '../components/ui';
import { VaultGate } from '../components/VaultGate';
import { WalletBar } from '../components/WalletBar';
import { getContractAddress, setContractAddress } from '../lib/config';
import { deployAs, joinAs, publicDataProvider, type TxStage } from '../lib/providers';
import { useApp } from '../state';

const isoToday = (plusYears = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + plusYears);
  return d.toISOString().slice(0, 10);
};

/** Runs one transaction with progress + error state. */
function useTx() {
  const [stage, setStage] = useState<TxStage>();
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState<unknown>();
  const run = async <T,>(
    f: (onStage: (s: TxStage) => void) => Promise<T>,
  ): Promise<T | undefined> => {
    setError(undefined);
    setStartedAt(Date.now());
    setStage('preparing');
    try {
      const out = await f(setStage);
      setStage('confirmed');
      return out;
    } catch (e) {
      setStage(undefined);
      setError(e);
      return undefined;
    }
  };
  const busy = stage !== undefined && stage !== 'confirmed';
  return { stage, startedAt, error, run, busy, reset: () => setStage(undefined) };
}

export function IssuerPage() {
  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1>Issuer desk</h1>
        <Banner kind="warn">
          <strong>DEMO: do not enter real data.</strong> This desk stands in for a KYC provider,
          bank or telco. It never accepts ID images; in production the issuer checks a real document
          before issuing.
        </Banner>
      </header>
      <VaultGate
        intro={
          <p className="muted">
            Issuer and admin keys are kept in the same encrypted on-device vault.
          </p>
        }
      >
        <WalletBar purpose="sign issuer and admin transactions" />
        <Desk />
      </VaultGate>
    </div>
  );
}

function Desk() {
  const { vault } = useApp();
  const [address, setAddress] = useState(getContractAddress());
  const [ledger, setLedger] = useState<Ledger | null>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!address) return;
    readLedger(publicDataProvider(), address).then(setLedger, () => setLedger(null));
  }, [address, refresh]);

  const issuerSk = vault?.data.issuer ? fromHex(vault.data.issuer.sk) : undefined;
  const issuerPk = issuerSk ? computeIssuerPk(issuerSk) : undefined;
  const approved = !!(issuerPk && ledger?.issuers.member(issuerPk));

  return (
    <>
      <AdminPanel
        address={address}
        ledger={ledger}
        issuerPk={issuerPk}
        onDeployed={(a) => {
          setContractAddress(a);
          setAddress(a);
        }}
        onChange={() => setRefresh((r) => r + 1)}
      />
      <IssuerKeyPanel issuerPk={issuerPk} approved={approved} />
      {address && issuerSk && issuerPk && (
        <IssueForm
          address={address}
          issuerSk={issuerSk}
          issuerPk={issuerPk}
          approved={approved}
          onIssued={() => setRefresh((r) => r + 1)}
        />
      )}
    </>
  );
}

function AdminPanel(props: {
  address?: string;
  ledger?: Ledger | null;
  issuerPk?: Uint8Array;
  onDeployed(a: string): void;
  onChange(): void;
}) {
  const { vault, updateVault, connected, wallet, toast } = useApp();
  const tx = useTx();
  const [pk, setPk] = useState('');
  const adminSk = vault?.data.admin ? fromHex(vault.data.admin.sk) : undefined;
  const isAdmin = !!(
    adminSk &&
    props.ledger &&
    toHex(props.ledger.admin) === toHex(computeAdminPk(adminSk))
  );

  const deploy = () =>
    tx.run(async (onStage) => {
      const w = connected();
      if (!w) throw new Error('AgePass: connect Lace first');
      const sk = adminSk ?? randomBytes32();
      if (!adminSk) await updateVault((d) => ({ ...d, admin: { sk: toHex(sk) } }));
      const api = await deployAs(w, createAgePassPrivateState(sk), onStage);
      props.onDeployed(api.contractAddress);
      toast('ok', 'AgePass deployed. You are its admin.');
    });

  const addIssuer = (target: string) =>
    tx.run(async (onStage) => {
      const w = connected();
      if (!w || !adminSk || !props.address) throw new Error('AgePass: connect Lace first');
      const api = await joinAs(
        w,
        props.address,
        'admin',
        createAgePassPrivateState(adminSk),
        onStage,
      );
      await api.addIssuer(fromHex(target, 32, 'issuer key'));
      toast('ok', 'Issuer approved on-chain');
      setPk('');
      props.onChange();
    });

  return (
    <Card title="Admin">
      {!props.address ? (
        <>
          <p>
            No AgePass deployment is configured. Deploy one with Lace; your browser keeps the admin
            key.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={wallet.kind !== 'connected' || tx.busy}
            onClick={() => void deploy()}
          >
            Deploy a new AgePass
          </button>
        </>
      ) : isAdmin ? (
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void addIssuer(pk);
          }}
        >
          <p className="muted small">
            You are the admin of this deployment. Approve issuer keys here.
          </p>
          <label className="field">
            <span className="label">Issuer public key</span>
            <input
              className="mono"
              value={pk}
              onChange={(e) => setPk(e.target.value)}
              placeholder="64 hex characters"
            />
          </label>
          <div className="row-wrap">
            <button
              className="btn btn-primary"
              disabled={tx.busy || wallet.kind !== 'connected' || pk.length === 0}
            >
              Approve issuer
            </button>
            {props.issuerPk && !props.ledger?.issuers.member(props.issuerPk) && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={tx.busy || wallet.kind !== 'connected'}
                onClick={() => void addIssuer(toHex(props.issuerPk!))}
              >
                Approve my own issuer key
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="muted small">
          This browser is not the admin of the configured deployment. Ask the admin to approve your
          issuer key.
        </p>
      )}
      {tx.stage && <TxProgress stage={tx.stage} startedAt={tx.startedAt} />}
      {tx.error !== undefined && <ErrorNotice error={tx.error} />}
    </Card>
  );
}

function IssuerKeyPanel({ issuerPk, approved }: { issuerPk?: Uint8Array; approved: boolean }) {
  const { updateVault, toast } = useApp();
  const [name, setName] = useState('Demo KYC Ltd');
  if (!issuerPk) {
    return (
      <Card title="Issuer key">
        <label className="field">
          <span className="label">Issuer display name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            void updateVault((d) => ({ ...d, issuer: { sk: toHex(randomBytes32()), name } })).then(
              () => toast('ok', 'Issuer key created'),
            )
          }
        >
          Create issuer key
        </button>
      </Card>
    );
  }
  return (
    <Card title="Issuer key">
      <span className={`pill ${approved ? 'pill-ok' : 'pill-warn'}`}>
        {approved ? 'approved' : 'not approved yet'}
      </span>
      <CopyField label="Issuer public key (give to the admin)" value={toHex(issuerPk)} />
    </Card>
  );
}

function IssueForm(props: {
  address: string;
  issuerSk: Uint8Array;
  issuerPk: Uint8Array;
  approved: boolean;
  onIssued(): void;
}) {
  const { vault, connected, wallet, toast } = useApp();
  const tx = useTx();
  const [holderPk, setHolderPk] = useState('');
  const [birth, setBirth] = useState('');
  const [expires, setExpires] = useState(isoToday(5));
  const [receipt, setReceipt] = useState<CredentialReceipt>();

  // Live preview of what goes into the tree: only this hash, never the inputs.
  const preview = useMemo(() => {
    try {
      return toHex(
        computeCommitment(
          {
            birthDate: parseIsoDate(birth),
            expiresOn: parseIsoDate(expires),
            issuerPk: props.issuerPk,
          },
          fromHex(holderPk, 32),
        ),
      );
    } catch {
      return undefined;
    }
  }, [birth, expires, holderPk, props.issuerPk]);

  const issue = (e: FormEvent) => {
    e.preventDefault();
    void tx.run(async (onStage) => {
      const w = connected();
      if (!w) throw new Error('AgePass: connect Lace first');
      const birthDate = parseIsoDate(birth);
      const expiresOn = parseIsoDate(expires);
      const hpk = fromHex(holderPk, 32, 'holder key');
      const api = await joinAs(
        w,
        props.address,
        'issuer',
        createAgePassPrivateState(props.issuerSk),
        onStage,
      );
      const res = await api.issueCredential({ birthDate, expiresOn, holderPk: hpk });
      setReceipt(
        createReceipt({
          contractAddress: props.address,
          issuerName: vault?.data.issuer?.name ?? 'Demo Issuer',
          issuerPk: props.issuerPk,
          holderPk: hpk,
          birthDate,
          expiresOn,
          txId: res.txId,
        }),
      );
      toast('ok', 'Credential issued');
      props.onIssued();
    });
  };

  const receiptJson = receipt ? JSON.stringify(receipt) : '';
  return (
    <Card title="Issue a credential">
      {!props.approved && (
        <Banner kind="warn">Your issuer key is not approved yet; issuing will be refused.</Banner>
      )}
      <form className="stack" onSubmit={issue}>
        <label className="field">
          <span className="label">Holder public key (from their wallet)</span>
          <input
            className="mono"
            value={holderPk}
            onChange={(e) => setHolderPk(e.target.value.trim())}
            placeholder="64 hex characters"
            required
          />
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="label">Verified birth date (DEMO)</span>
            <input
              type="date"
              value={birth}
              max={isoToday()}
              onChange={(e) => setBirth(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="label">Credential expires</span>
            <input
              type="date"
              value={expires}
              min={isoToday()}
              onChange={(e) => setExpires(e.target.value)}
              required
            />
          </label>
        </div>
        <div className="field">
          <span className="label">Commitment that goes on-chain</span>
          <code className="mono small break">
            {preview ?? '— fill in a valid holder key and dates —'}
          </code>
          <span className="muted small">
            Only this hash enters the Merkle tree, and tree inserts hide even the hash.
          </span>
        </div>
        <button
          className="btn btn-primary"
          disabled={tx.busy || wallet.kind !== 'connected' || !preview}
        >
          Issue credential
        </button>
      </form>
      {tx.stage && <TxProgress stage={tx.stage} startedAt={tx.startedAt} />}
      {tx.error !== undefined && <ErrorNotice error={tx.error} />}
      {receipt && (
        <div className="stack">
          <h3>Receipt for the holder</h3>
          <p className="muted small">
            Hand this over privately (it contains the birth date). The holder imports it into their
            wallet.
          </p>
          <div className="row-wrap">
            <Qr value={receiptJson} label="credential receipt" />
            <div className="stack">
              <CopyField label="Receipt JSON" value={receiptJson} />
              <a
                className="btn btn-ghost btn-small"
                download="agepass-receipt.json"
                href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(receipt, null, 2))}`}
              >
                Download receipt
              </a>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
