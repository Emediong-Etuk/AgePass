// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Scripted end-to-end AgePass story against the local devnet. Non-interactive.
//   npm run demo:local   narrated demo (the core of the demo video)
//   npm run e2e:local    same flow with assertions; exits 1 on any failed check
//
// All people and dates here are fictional DEMO data.

import { ContractState } from '@midnight-ntwrk/compact-runtime';
import {
  type AgePassAPI,
  type AgePassChallenge,
  type Ledger,
  ageOn,
  computeHolderPk,
  computeIssuerPk,
  computeNym,
  computeSiteId,
  createAgePassPrivateState,
  createChallenge,
  createReceipt,
  cutoffForAge,
  describeError,
  evaluateLedger,
  formatIsoDate,
  passwordProblem,
  randomBytes32,
  shortHex,
  toBase64Url,
  toHex,
  toYYYYMMDD,
  verifyReceipt,
} from '@agepass/sdk';
import { loadConfig } from './config.js';
import { ensureDevnet } from './devnet.js';
import { c, log, quietNetworkNoise, reportError } from './log.js';
import { type Session, openSession, publicData } from './session.js';

quietNetworkNoise();
const ASSERT = process.argv.includes('--assert');
const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  if (ok) {
    if (ASSERT) log.info(`✓ ${what}`);
  } else {
    failures.push(what);
    log.fail(`CHECK FAILED: ${what}`);
  }
};

/** A throwaway passphrase that satisfies the Midnight.js storage policy. */
function demoPassphrase(): string {
  for (;;) {
    const p = `Demo-${toBase64Url(toHex(randomBytes32())).slice(0, 18)}-9x`;
    if (passwordProblem(p) === null) return p;
  }
}

const yearsAgo = (years: number, today: Date): Date =>
  new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate()));

async function timed<T>(label: string, f: () => Promise<T>): Promise<T> {
  const start = Date.now();
  log.step(`${label}…`);
  const out = await f();
  log.info(`done in ${((Date.now() - start) / 1000).toFixed(1)} s`);
  return out;
}

async function main(): Promise<void> {
  const config = loadConfig('undeployed');
  const today = new Date();
  log.title('AgePass local demo');
  log.info('Prove you are 18+ without showing your ID. Everything below is DEMO data.');

  await ensureDevnet(config, log);
  const session = await openSession(config, log, {
    storagePassword: demoPassphrase(),
    storeName: `agepass-demo-${Date.now()}`,
  });
  try {
    await story(session, today);
  } finally {
    await session.close();
  }
}

async function story(session: Session, today: Date): Promise<void> {
  // ── 1. Deploy ─────────────────────────────────────────────────────────────────────
  log.title('1. Deploy AgePass (the deployer becomes admin)');
  const adminSk = randomBytes32();
  const admin = await timed('Deploying contract', () =>
    session.deploy(createAgePassPrivateState(adminSk), 'admin'),
  );
  log.kv('contract', admin.contractAddress);

  // ── 2. Approve an issuer ───────────────────────────────────────────────────────────
  log.title('2. Admin approves an issuer (a KYC provider, bank or telco in real life)');
  const issuerSk = randomBytes32();
  const issuerPk = computeIssuerPk(issuerSk);
  const issuer = await session.join(
    admin.contractAddress,
    'issuer',
    createAgePassPrivateState(issuerSk),
  );
  await timed('admin → addIssuer', () => admin.addIssuer(issuerPk));
  log.kv('issuer key', shortHex(issuerPk, 6));

  // ── 3. Issue credentials ───────────────────────────────────────────────────────────
  log.title('3. Issuer checks ID once, off-chain, and issues credentials');
  const ada = await enrol(session, issuer, issuerPk, admin.contractAddress, {
    name: 'Ada (adult)',
    id: 'holder:ada',
    birth: toYYYYMMDD(yearsAgo(27, today)),
    expires: toYYYYMMDD(yearsAgo(-5, today)),
  });
  const max = await enrol(session, issuer, issuerPk, admin.contractAddress, {
    name: 'Max (16, minor)',
    id: 'holder:max',
    birth: toYYYYMMDD(yearsAgo(16, today)),
    expires: toYYYYMMDD(yearsAgo(-5, today)),
  });

  // ── 4. A site asks ─────────────────────────────────────────────────────────────────
  log.title('4. Corner Cellar (demo store) asks: "Are you 18 or older?"');
  const cellar = createChallenge({
    siteDomain: 'cornercellar.example',
    minAge: 18,
    siteName: 'Corner Cellar (demo store)',
    today,
  });
  printChallenge(cellar);

  // ── 5. Ada proves ──────────────────────────────────────────────────────────────────
  log.title('5. Ada proves she is 18+ with a zero-knowledge proof');
  const adaNymCellar = await proveAndCheck(session, ada.api, cellar, ada.sk);
  check(adaNymCellar !== undefined, 'Ada is verified at Corner Cellar');

  // ── 6. Max tries ───────────────────────────────────────────────────────────────────
  log.title('6. Max (16) tries the same store');
  const maxChallenge = createChallenge({ siteDomain: 'cornercellar.example', minAge: 18, today });
  await expectBlocked(session, max.api, maxChallenge, 'age requirement not met');

  // ── 7. Replay ──────────────────────────────────────────────────────────────────────
  log.title("7. Someone replays Ada's already-answered challenge");
  await expectBlocked(session, ada.api, cellar, 'already answered');

  // ── 8. Second site ─────────────────────────────────────────────────────────────────
  log.title('8. Ada visits a different site: a new, unlinkable nickname');
  const arcade = createChallenge({
    siteDomain: 'arcade.example',
    minAge: 18,
    siteName: 'Pixel Arcade (demo)',
    today,
  });
  const adaNymArcade = await proveAndCheck(session, ada.api, arcade, ada.sk);
  check(
    adaNymArcade !== undefined && adaNymArcade !== adaNymCellar,
    "Ada's nym differs between the two sites",
  );
  log.kv('Corner Cellar', `nym ${shortHex(adaNymCellar ?? '', 6)}`);
  log.kv('Pixel Arcade', `nym ${shortHex(adaNymArcade ?? '', 6)}`);

  // ── 9. Public ledger ───────────────────────────────────────────────────────────────
  log.title('9. Everything the public can see on-chain');
  await printPublicLedger(session, admin, [ada, max], issuerPk);

  log.title(failures.length === 0 ? 'Demo complete' : 'Demo finished with failures');
  log.kv('transactions', String(session.submittedCount()));
  if (ASSERT) {
    if (failures.length > 0) throw new Error(`${failures.length} e2e check(s) failed`);
    log.ok('e2e: all checks passed');
  }
}

type Enrolled = { name: string; sk: Uint8Array; birth: bigint; api: AgePassAPI };

async function enrol(
  session: Session,
  issuer: AgePassAPI,
  issuerPk: Uint8Array,
  contractAddress: string,
  p: { name: string; id: string; birth: bigint; expires: bigint },
): Promise<Enrolled> {
  // The holder creates their secret on their own device and shows only the holder key.
  const sk = randomBytes32();
  const holderPk = computeHolderPk(sk);
  log.step(`${c.bold(p.name)} shows holder key ${shortHex(holderPk, 6)} to the issuer`);
  const tx = await timed(`issuer → issueCredential (born ${formatIsoDate(p.birth)}, DEMO)`, () =>
    issuer.issueCredential({ birthDate: p.birth, expiresOn: p.expires, holderPk }),
  );
  const receipt = createReceipt({
    contractAddress,
    issuerName: 'Demo Issuer',
    issuerPk,
    holderPk,
    birthDate: p.birth,
    expiresOn: p.expires,
    txId: tx.txId,
  });
  const api = await session.join(contractAddress, p.id, createAgePassPrivateState(sk));
  const ledger = await mustRead(api);
  const imported = verifyReceipt(receipt, sk, ledger);
  await api.setPrivateState(createAgePassPrivateState(sk, imported.credential));
  log.ok(`${p.name} imported the receipt; credential found in the registry`);
  check(
    ledger.credentials.findPathForLeaf(imported.commitment) !== undefined,
    `${p.name}'s credential is in the tree`,
  );
  return { name: p.name, sk, birth: p.birth, api };
}

function printChallenge(ch: AgePassChallenge): void {
  log.kv('site', `${ch.siteName ?? ch.siteDomain} (${ch.siteDomain})`);
  log.kv('challengeId', shortHex(ch.challengeId, 6));
  log.kv('cutoffDate', `${formatIsoDate(ch.cutoffDate)} (born on or before)`);
  log.kv('checkedOn', formatIsoDate(ch.checkedOn));
}

async function mustRead(api: AgePassAPI): Promise<Ledger> {
  const l = await api.readLedger();
  if (l === null) throw new Error('AgePass: contract state not found');
  return l;
}

async function proveAndCheck(
  session: Session,
  holder: AgePassAPI,
  ch: AgePassChallenge,
  sk: Uint8Array,
): Promise<string | undefined> {
  await timed(`Generating ZK proof and submitting proveAge`, () => holder.proveAge(ch));
  const result = evaluateLedger(ch, await mustRead(holder));
  if (result.status !== 'verified') {
    log.fail(`site check: ${result.status}`);
    return undefined;
  }
  const expected = toHex(computeNym(sk, computeSiteId(ch.siteDomain)));
  check(result.nym === expected, 'nym on-chain equals hash(holder secret, site)');
  log.ok(`${c.bold('verified')} at ${ch.siteDomain}: welcome, nym ${shortHex(result.nym, 6)}`);
  log.info(
    `on-chain record → siteId ${shortHex(result.record.siteId)}, cutoff ${formatIsoDate(result.record.cutoffDate)}, checked ${formatIsoDate(result.record.checkedOn)}`,
  );
  void session;
  return result.nym;
}

async function expectBlocked(
  session: Session,
  holder: AgePassAPI,
  ch: AgePassChallenge,
  reason: string,
): Promise<void> {
  const before = session.submittedCount();
  const countBefore = (await mustRead(holder)).verificationCount;
  try {
    await holder.proveAge(ch);
    check(false, `proof should have been blocked (${reason})`);
  } catch (e) {
    const f = describeError(e);
    check(f.detail.includes(reason), `blocked because: ${reason}`);
    log.fail(`${f.title} ${c.dim(`(${reason})`)}`);
  }
  const sent = session.submittedCount() - before;
  check(sent === 0, 'no transaction was submitted');
  check((await mustRead(holder)).verificationCount === countBefore, 'ledger unchanged');
  log.info(`transactions sent for this attempt: ${sent}. Nothing reached the chain.`);
}

async function printPublicLedger(
  session: Session,
  admin: AgePassAPI,
  holders: Enrolled[],
  issuerPk: Uint8Array,
): Promise<void> {
  const l = await mustRead(admin);
  log.kv('admin', shortHex(l.admin, 6));
  log.kv('issuers', [...l.issuers].map((pk) => shortHex(pk, 6)).join(', '));
  log.kv('credentials', `${l.credentialCount} (as Merkle leaf hashes; no names, no dates)`);
  log.kv('verifications', String(l.verificationCount));
  for (const [id, v] of l.verifications) {
    console.log(
      `    ${c.dim(shortHex(id, 4))}  site ${shortHex(v.siteId, 4)}  nym ${shortHex(v.nym, 4)}  cutoff ${formatIsoDate(v.cutoffDate)}  checked ${formatIsoDate(v.checkedOn)}`,
    );
  }
  check(
    [...l.issuers].some((pk) => toHex(pk) === toHex(issuerPk)),
    'issuer is listed publicly',
  );

  // Scan the raw serialized contract state, exactly as the indexer serves it.
  const raw = await publicData(loadConfig('undeployed')).queryContractState(admin.contractAddress);
  const cs = new ContractState();
  if (raw !== null) cs.data = raw.data;
  const hex = toHex(cs.serialize());
  for (const h of holders) {
    const le = new Uint8Array(4);
    new DataView(le.buffer).setUint32(0, Number(h.birth), true);
    const leaks = [toHex(h.sk), toHex(computeHolderPk(h.sk)), toHex(le)].filter((needle) =>
      hex.includes(needle),
    );
    check(leaks.length === 0, `no secret, holder key or birth date of ${h.name} on-chain`);
  }
  log.ok(
    `Scanned ${hex.length / 2} bytes of public state: no birth dates, holder keys or secrets.`,
  );
  log.info(
    `Ada is ${ageOn(holders[0]?.birth ?? 0n, new Date())}: the chain only knows she was born on or before ${formatIsoDate(cutoffForAge(18))}.`,
  );
  void session;
}

main().then(
  () => process.exit(0),
  (e: unknown) => process.exit(reportError(e)),
);
