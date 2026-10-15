// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// The holder's wallet: key creation, credential import, and approving a site's age request.

import { type ChangeEvent, useMemo, useState } from 'react';
import {
  type AgePassChallenge,
  challengeAgeInDays,
  computeHolderPk,
  createAgePassPrivateState,
  decodeChallengeFromUrl,
  formatIsoDate,
  fromHex,
  parseReceipt,
  randomBytes32,
  readLedger,
  shortHex,
  toHex,
  verifyReceipt,
} from '@agepass/sdk';
import { Banner, Card, CopyField, ErrorNotice, Qr, TxProgress } from '../components/ui';
import { VaultGate } from '../components/VaultGate';
import { WalletBar } from '../components/WalletBar';
import { getContractAddress, setContractAddress } from '../lib/config';
import { canProve } from '../lib/lace';
import { joinAs, publicDataProvider, type TxStage } from '../lib/providers';
import { href, type Route } from '../lib/router';
import type { VaultCredential } from '../lib/vault';
import { useApp } from '../state';

const todayYmd = () => {
  const d = new Date();
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};

export function WalletPage({ route }: { route: Route }) {
  const requestParam = route.params.get('request');
  const returnTo = route.params.get('return') ?? undefined;
  const parsed = useMemo(() => {
    if (!requestParam) return undefined;
    try {
      return { ok: true as const, challenge: decodeChallengeFromUrl(requestParam) };
    } catch (e) {
      return { ok: false as const, error: e };
    }
  }, [requestParam]);

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1>Your AgePass wallet</h1>
        <p className="muted">Your secret key and credential never leave this browser.</p>
      </header>
      {parsed && !parsed.ok && <ErrorNotice error={parsed.error} />}
      <VaultGate
        intro={
          <p className="muted">
            {parsed?.ok
              ? `${parsed.challenge.siteName ?? parsed.challenge.siteDomain} is asking for an age check. Unlock your wallet to answer.`
              : 'Choose a passphrase to protect your AgePass key on this device.'}
          </p>
        }
      >
        <HolderWallet challenge={parsed?.ok ? parsed.challenge : undefined} returnTo={returnTo} />
      </VaultGate>
    </div>
  );
}

function HolderWallet({
  challenge,
  returnTo,
}: {
  challenge?: AgePassChallenge;
  returnTo?: string;
}) {
  const { vault, updateVault, toast } = useApp();
  const holder = vault?.data.holder;

  if (!holder) {
    return (
      <Card title="Step 1 · Create your holder key">
        <p>
          Your holder key is a random secret generated on this device. You show the issuer only its
          public part, once.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            void updateVault((d) => ({ ...d, holder: { sk: toHex(randomBytes32()) } })).then(() =>
              toast('ok', 'Holder key created'),
            )
          }
        >
          Generate my AgePass key
        </button>
      </Card>
    );
  }

  const sk = fromHex(holder.sk);
  const holderPk = toHex(computeHolderPk(sk));
  return (
    <>
      {challenge && holder.credential && (
        <ApproveRequest
          challenge={challenge}
          sk={sk}
          credential={holder.credential}
          returnTo={returnTo}
        />
      )}
      {challenge && !holder.credential && (
        <Banner kind="warn">
          {challenge.siteName ?? challenge.siteDomain} asked for an age check, but there is no
          credential on this device yet. Import your issuer’s receipt below first.
        </Banner>
      )}
      {holder.credential ? (
        <CredentialCard credential={holder.credential} />
      ) : (
        <ImportCredential sk={sk} />
      )}
      <Card title="Your holder key">
        <p className="muted small">
          Show this to your issuer (paste or QR). It is a hash of your secret: it cannot be used to
          prove anything, and sites never see it.
        </p>
        <div className="row-wrap">
          <Qr value={holderPk} label="holder key" />
          <CopyField label="Holder public key" value={holderPk} />
        </div>
      </Card>
    </>
  );
}

function CredentialCard({ credential }: { credential: VaultCredential }) {
  const [show, setShow] = useState(false);
  const expired = credential.expiresOn < todayYmd();
  return (
    <Card title="Your credential" className="credential">
      <div className="cred">
        <div className="cred-top">
          <span className={`pill ${expired ? 'pill-bad' : 'pill-ok'}`}>
            {expired ? 'expired' : 'valid'}
          </span>
          <span className="muted small">AgePass · {shortHex(credential.contractAddress, 4)}</span>
        </div>
        <dl className="kv">
          <dt>Issuer</dt>
          <dd>{credential.issuerName}</dd>
          <dt>Expires</dt>
          <dd>{formatIsoDate(credential.expiresOn)}</dd>
          <dt>Birth date</dt>
          <dd>
            {show ? formatIsoDate(credential.birthDate) : '•••• - •• - ••'}{' '}
            <button type="button" className="btn btn-link small" onClick={() => setShow((s) => !s)}>
              {show ? 'hide' : 'show'}
            </button>
          </dd>
        </dl>
        <p className="muted small">
          Shown only on this device. It is never sent to sites or written on-chain.
        </p>
      </div>
    </Card>
  );
}

function ImportCredential({ sk }: { sk: Uint8Array }) {
  const { updateVault, toast } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void f.text().then(setText);
  };

  const doImport = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const receipt = parseReceipt(text);
      const configured = getContractAddress();
      if (configured && configured !== receipt.contractAddress) {
        throw new Error(
          `AgePass: this receipt is for deployment ${shortHex(receipt.contractAddress)}, but the app uses ${shortHex(configured)}. Switch deployment in the Explorer first.`,
        );
      }
      // Never accept a receipt blindly: it must be for this key and actually be in the tree.
      const ledger = await readLedger(publicDataProvider(), receipt.contractAddress);
      if (ledger === null)
        throw new Error('AgePass: that AgePass deployment was not found on this network');
      const imported = verifyReceipt(receipt, sk, ledger);
      if (!configured) setContractAddress(receipt.contractAddress);
      await updateVault((d) => ({
        ...d,
        holder: {
          sk: toHex(sk),
          credential: {
            birthDate: Number(imported.credential.birthDate),
            expiresOn: Number(imported.credential.expiresOn),
            issuerPk: toHex(imported.credential.issuerPk),
            issuerName: imported.issuerName,
            contractAddress: imported.contractAddress,
            commitment: toHex(imported.commitment),
            importedAt: new Date().toISOString(),
          },
        },
      }));
      toast('ok', 'Credential verified on-chain and saved');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Step 2 · Import your credential">
      <p className="muted small">
        Paste the receipt your issuer gave you, or open the file. AgePass checks it was issued to{' '}
        <em>your</em> key and that it really is in the on-chain registry before saving it.
      </p>
      <textarea
        className="mono"
        rows={6}
        placeholder='{"kind":"agepass-credential", ...}'
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Credential receipt JSON"
      />
      <div className="row-wrap">
        <label className="btn btn-ghost btn-small">
          Open file
          <input type="file" accept="application/json,.json" hidden onChange={onFile} />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || text.trim() === ''}
          onClick={() => void doImport()}
        >
          {busy ? 'Checking registry…' : 'Import credential'}
        </button>
      </div>
      {error !== undefined && <ErrorNotice error={error} />}
    </Card>
  );
}

function ApproveRequest({
  challenge,
  sk,
  credential,
  returnTo,
}: {
  challenge: AgePassChallenge;
  sk: Uint8Array;
  credential: VaultCredential;
  returnTo?: string;
}) {
  const { connected, wallet, toast } = useApp();
  const [stage, setStage] = useState<TxStage>();
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState<unknown>();
  const [declined, setDeclined] = useState(false);
  const site = challenge.siteName ?? challenge.siteDomain;
  const staleDays = challengeAgeInDays(challenge);

  // The circuit enforces these too; checking first spares an underage user the wallet prompt.
  const localBlock =
    BigInt(credential.birthDate) > BigInt(challenge.cutoffDate)
      ? 'age'
      : BigInt(challenge.checkedOn) > BigInt(credential.expiresOn)
        ? 'expired'
        : undefined;

  const approve = async () => {
    const w = connected();
    if (!w) return;
    setError(undefined);
    setStartedAt(Date.now());
    setStage('preparing');
    try {
      const holder = await joinAs(
        w,
        credential.contractAddress,
        'holder',
        createAgePassPrivateState(sk, {
          birthDate: BigInt(credential.birthDate),
          expiresOn: BigInt(credential.expiresOn),
          issuerPk: fromHex(credential.issuerPk),
        }),
        setStage,
      );
      await holder.proveAge(challenge);
      setStage('confirmed');
      toast('ok', `Proof accepted. ${site} can now see your “yes”.`);
    } catch (e) {
      setStage(undefined);
      setError(e);
    }
  };

  if (declined) {
    return (
      <Banner kind="info">
        You declined. Nothing was shared with {site}.{' '}
        {returnTo && <a href={`#${returnTo}`}>Back to {site}</a>}
      </Banner>
    );
  }

  return (
    <Card title="Age request" className="approve">
      <p className="ask">
        <strong>{site}</strong> wants to know: <strong>Are you {challenge.minAge} or older?</strong>
      </p>
      <div className="grid-2 small">
        <div className="learn-box">
          <strong>They will learn</strong>
          <p>Yes, plus a private nickname just for this site.</p>
        </div>
        <div className="never-box">
          <strong>They will NOT learn</strong>
          <p>Your name, birth date, ID, or activity on other sites.</p>
        </div>
      </div>
      <p className="muted small">
        Site domain <code>{challenge.siteDomain}</code> · request {shortHex(challenge.challengeId)}{' '}
        · born on or before {formatIsoDate(challenge.cutoffDate)}
      </p>
      {staleDays > 1 && (
        <Banner kind="warn">This request is {staleDays} days old. The site may reject it.</Banner>
      )}

      {localBlock ? (
        <Banner kind="info">
          <strong>AgePass couldn’t confirm this request.</strong>{' '}
          {localBlock === 'expired'
            ? 'Your credential has expired; ask your issuer for a new one.'
            : ''}{' '}
          Nothing was shared with {site}, and nothing was sent to the network.
          {returnTo && (
            <div>
              <a href={`#${returnTo}`}>Back to {site}</a>
            </div>
          )}
        </Banner>
      ) : stage ? (
        <>
          <TxProgress stage={stage} startedAt={startedAt} />
          {stage === 'confirmed' && returnTo && (
            <a className="btn btn-primary" href={`#${returnTo}`}>
              Return to {site}
            </a>
          )}
        </>
      ) : (
        <>
          {wallet.kind !== 'connected' && (
            <WalletBar purpose="pay the small network fee for your proof" />
          )}
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                wallet.kind !== 'connected' || (wallet.kind === 'connected' && !canProve(wallet))
              }
              onClick={() => void approve()}
            >
              Approve
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDeclined(true)}>
              Decline
            </button>
          </div>
          {wallet.kind === 'connected' && <WalletBar purpose="prove" />}
        </>
      )}
      {error !== undefined && <ErrorNotice error={error} />}
      <p className="muted small">
        <a href={href('/explorer')}>See exactly what gets published</a>
      </p>
    </Card>
  );
}
