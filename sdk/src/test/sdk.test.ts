// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory

import { describe, expect, it } from 'vitest';
import { createAgePassPrivateState, pureCircuits } from '@agepass/contract';
import { AgePassSimulator } from '../../../contract/src/test/agepass.simulator.js';
import {
  AgePassConfigError,
  AgePassInputError,
  AgePassNotFoundError,
  AgePassPasswordError,
  assertStrongPassword,
  bytesEqual,
  challengeAgeInDays,
  challengeToCircuitArgs,
  checkVerification,
  computeCommitment,
  computeHolderPk,
  computeIssuerPk,
  computeNym,
  computeSiteId,
  createChallenge,
  createReceipt,
  decodeChallengeFromUrl,
  describeError,
  encodeChallengeForUrl,
  evaluateLedger,
  evaluateRecord,
  fromBase64Url,
  fromHex,
  isAgePassNetwork,
  networkConfig,
  normalizeDomain,
  parseChallenge,
  parseIsoDate,
  parseReceipt,
  passwordProblem,
  randomBytes32,
  shortHex,
  toBase64Url,
  toHex,
  verifyReceipt,
  waitForVerification,
  type AgePassChallenge,
} from '../index.js';

const TODAY = new Date(Date.UTC(2026, 9, 15));

/** Simulated AgePass with one issuer and one adult holder, driven through the SDK helpers. */
function world() {
  const adminSk = randomBytes32();
  const sim = new AgePassSimulator(adminSk);
  const issuerSk = randomBytes32();
  const issuerPk = computeIssuerPk(issuerSk);
  sim.as(createAgePassPrivateState(adminSk)).addIssuer(issuerPk);

  const holderSk = randomBytes32();
  const holderPk = computeHolderPk(holderSk);
  const birthDate = parseIsoDate('1995-03-12');
  const expiresOn = parseIsoDate('2031-10-15');
  sim.as(createAgePassPrivateState(issuerSk)).issueCredential(birthDate, expiresOn, holderPk);
  const receipt = createReceipt({
    contractAddress: 'test-address',
    issuerName: 'Demo Issuer',
    issuerPk,
    holderPk,
    birthDate,
    expiresOn,
    txId: 'tx1',
  });
  return { sim, adminSk, issuerSk, issuerPk, holderSk, holderPk, receipt, birthDate, expiresOn };
}

const prove = (w: ReturnType<typeof world>, c: AgePassChallenge) => {
  const imported = verifyReceipt(w.receipt, w.holderSk, w.sim.ledger());
  w.sim
    .as(createAgePassPrivateState(w.holderSk, imported.credential))
    .proveAge(challengeToCircuitArgs(c));
};

describe('keys: every hash comes from the contract pure circuits', () => {
  it('matches the generated circuits byte for byte', () => {
    const sk = randomBytes32();
    const site = computeSiteId('shop.example');
    expect(computeHolderPk(sk)).toEqual(pureCircuits.holderPublicKey(sk));
    expect(computeIssuerPk(sk)).toEqual(pureCircuits.issuerPublicKey(sk));
    expect(computeNym(sk, site)).toEqual(pureCircuits.sitePseudonym(sk, site));
  });

  it('normalizes domains so equivalent URLs give the same site id', () => {
    expect(normalizeDomain('https://Shop.Example.com:443/age?x=1')).toBe('shop.example.com');
    expect(computeSiteId('https://shop.example.com/')).toEqual(computeSiteId('SHOP.example.com.'));
    expect(toHex(computeSiteId('a.example'))).not.toBe(toHex(computeSiteId('b.example')));
  });

  it.each(['', 'not a domain', '..example', 'exa mple.com', '.example'])(
    'rejects invalid domain %j',
    (d) => {
      expect(() => computeSiteId(d)).toThrow(AgePassInputError);
    },
  );

  it('rejects domains longer than 128 bytes', () => {
    expect(() => computeSiteId(`${'a'.repeat(125)}.com`)).toThrow(/longer than 128/);
  });
});

describe('bytes', () => {
  it('round-trips hex and base64url', () => {
    const b = randomBytes32();
    expect(fromHex(toHex(b))).toEqual(b);
    expect(fromHex(`0x${toHex(b)}`, 32)).toEqual(b);
    expect(fromBase64Url(toBase64Url('héllo / wörld?'))).toBe('héllo / wörld?');
    expect(bytesEqual(b, b.slice())).toBe(true);
    expect(bytesEqual(b, randomBytes32())).toBe(false);
  });

  it('rejects bad hex and bad lengths with readable messages', () => {
    expect(() => fromHex('zz')).toThrow(/hexadecimal/);
    expect(() => fromHex('abc')).toThrow(/hexadecimal/);
    expect(() => fromHex('abcd', 32, 'holder key')).toThrow(/holder key must be 32 bytes/);
    expect(() => fromBase64Url('***')).toThrow(/malformed/);
  });

  it('shortens hex for display', () => {
    expect(shortHex('3fa1000000009c0e')).toBe('0x3fa1…9c0e');
    expect(shortHex('3fa1')).toBe('0x3fa1');
  });
});

describe('challenges', () => {
  it('carries a random id, the site id and dates derived from minAge and today', () => {
    const c = createChallenge({ siteDomain: 'CornerCellar.example', minAge: 18, today: TODAY });
    expect(c.challengeId).toMatch(/^[0-9a-f]{64}$/);
    expect(c.siteDomain).toBe('cornercellar.example');
    expect(c.siteId).toBe(toHex(computeSiteId('cornercellar.example')));
    expect(c.cutoffDate).toBe(20081015);
    expect(c.checkedOn).toBe(20261015);
    expect(createChallenge({ siteDomain: 'a.example', minAge: 18 }).challengeId).not.toBe(
      c.challengeId,
    );
  });

  it('round-trips through JSON and the URL fragment', () => {
    const c = createChallenge({
      siteDomain: 'cornercellar.example',
      minAge: 18,
      siteName: 'Corner Cellar (demo store)',
      today: TODAY,
    });
    expect(parseChallenge(JSON.stringify(c))).toEqual(c);
    expect(decodeChallengeFromUrl(encodeChallengeForUrl(c))).toEqual(c);
    const args = challengeToCircuitArgs(c);
    expect(args.cutoffDate).toBe(20081015n);
    expect(toHex(args.siteId)).toBe(c.siteId);
  });

  it('rejects a request whose site id does not belong to the shown domain', () => {
    const c = createChallenge({ siteDomain: 'evil.example', minAge: 18, today: TODAY });
    const forged = { ...c, siteDomain: 'cornercellar.example' };
    expect(() => parseChallenge(forged)).toThrow(/does not belong/);
  });

  it('rejects a request whose cutoff does not match its minimum age', () => {
    const c = createChallenge({ siteDomain: 'shop.example', minAge: 18, today: TODAY });
    expect(() => parseChallenge({ ...c, cutoffDate: 20101015 })).toThrow(/do not match/);
  });

  it.each([
    ['not json', '{'],
    ['wrong kind', JSON.stringify({ kind: 'x', version: 1 })],
    ['missing fields', JSON.stringify({ kind: 'agepass-challenge', version: 1 })],
    ['null', 'null'],
  ])('rejects %s', (_label, input) => {
    expect(() => parseChallenge(input)).toThrow(AgePassInputError);
  });

  it('reports how old a request is', () => {
    const c = createChallenge({ siteDomain: 'shop.example', minAge: 18, today: TODAY });
    expect(challengeAgeInDays(c, TODAY)).toBe(0);
    expect(challengeAgeInDays(c, new Date(Date.UTC(2026, 9, 17)))).toBe(2);
  });
});

describe('verifier: the site checks the record against ITS challenge', () => {
  it('is pending before the holder answers, verified after, with the right nym', async () => {
    const w = world();
    const c = createChallenge({ siteDomain: 'cornercellar.example', minAge: 18, today: TODAY });
    expect(evaluateLedger(c, w.sim.ledger())).toEqual({ status: 'pending' });
    prove(w, c);
    const result = await checkVerification(async () => w.sim.ledger(), c);
    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.nym).toBe(toHex(computeNym(w.holderSk, computeSiteId('cornercellar.example'))));
    }
  });

  it('rejects a record made for another site', () => {
    const w = world();
    const theirs = createChallenge({ siteDomain: 'other.example', minAge: 18, today: TODAY });
    prove(w, theirs);
    const mine: AgePassChallenge = {
      ...createChallenge({ siteDomain: 'cornercellar.example', minAge: 18, today: TODAY }),
      challengeId: theirs.challengeId,
    };
    expect(evaluateLedger(mine, w.sim.ledger())).toMatchObject({
      status: 'rejected',
      reason: 'wrong-site',
    });
  });

  it('rejects a record whose holder chose a laxer cutoff', () => {
    const w = world();
    const c = createChallenge({ siteDomain: 'shop.example', minAge: 21, today: TODAY });
    // Malicious client answers "18+" to a "21+" request by changing the cutoff it submits.
    prove(w, { ...c, cutoffDate: 20081015 });
    expect(evaluateLedger(c, w.sim.ledger())).toMatchObject({
      status: 'rejected',
      reason: 'wrong-cutoff',
    });
  });

  it('rejects a record with a different check date', () => {
    const w = world();
    const c = createChallenge({ siteDomain: 'shop.example', minAge: 18, today: TODAY });
    const record = {
      siteId: fromHex(c.siteId),
      nym: randomBytes32(),
      cutoffDate: BigInt(c.cutoffDate),
      checkedOn: 20261001n,
    };
    expect(evaluateRecord(c, record)).toMatchObject({ status: 'rejected', reason: 'wrong-date' });
    void w;
  });

  it('reports a missing contract', async () => {
    const c = createChallenge({ siteDomain: 'shop.example', minAge: 18, today: TODAY });
    await expect(checkVerification(async () => null, c, 'addr')).rejects.toThrow(
      AgePassNotFoundError,
    );
  });

  it('waits until the record appears', async () => {
    const w = world();
    const c = createChallenge({ siteDomain: 'shop.example', minAge: 18, today: TODAY });
    let polls = 0;
    const result = await waitForVerification(
      async () => {
        if (++polls === 3) prove(w, c);
        return w.sim.ledger();
      },
      c,
      { intervalMs: 1 },
    );
    expect(result.status).toBe('verified');
    expect(polls).toBe(3);
  });

  it('gives up after the timeout', async () => {
    const w = world();
    const c = createChallenge({ siteDomain: 'shop.example', minAge: 18, today: TODAY });
    const result = await waitForVerification(async () => w.sim.ledger(), c, {
      intervalMs: 1,
      timeoutMs: 5,
    });
    expect(result.status).toBe('pending');
  });
});

describe('receipts', () => {
  it('accepts a genuine receipt for this holder that is in the registry', () => {
    const w = world();
    const parsed = parseReceipt(JSON.stringify(w.receipt));
    const imported = verifyReceipt(parsed, w.holderSk, w.sim.ledger());
    expect(imported.credential.birthDate).toBe(w.birthDate);
    expect(imported.issuerStillApproved).toBe(true);
    expect(imported.commitment).toEqual(
      computeCommitment(imported.credential, computeHolderPk(w.holderSk)),
    );
  });

  it('refuses a receipt issued to someone else', () => {
    const w = world();
    expect(() => verifyReceipt(w.receipt, randomBytes32(), w.sim.ledger())).toThrow(
      /different holder key/,
    );
  });

  it('refuses a receipt whose birth date was edited', () => {
    const w = world();
    const edited = { ...w.receipt, birthDate: '1990-01-01' };
    expect(() => verifyReceipt(edited, w.holderSk, w.sim.ledger())).toThrow(/altered/);
  });

  it('refuses a receipt that was never issued on-chain', () => {
    const w = world();
    const fake = createReceipt({
      contractAddress: 'x',
      issuerName: 'Fake',
      issuerPk: w.issuerPk,
      holderPk: w.holderPk,
      birthDate: parseIsoDate('1980-01-01'),
      expiresOn: parseIsoDate('2031-01-01'),
    });
    expect(() => verifyReceipt(fake, w.holderSk, w.sim.ledger())).toThrow(/not in the AgePass/);
  });

  it('flags credentials from an issuer that has since been removed', () => {
    const w = world();
    w.sim.as(createAgePassPrivateState(w.adminSk)).removeIssuer(w.issuerPk);
    expect(verifyReceipt(w.receipt, w.holderSk, w.sim.ledger()).issuerStillApproved).toBe(false);
  });

  it.each(['{', 'null', JSON.stringify({ kind: 'agepass-credential', version: 1 })])(
    'rejects malformed receipt %j',
    (bad) => {
      expect(() => parseReceipt(bad)).toThrow(AgePassInputError);
    },
  );
});

describe('passphrase policy (delegates to Midnight.js validatePassword)', () => {
  it.each([
    ['', 'missing'],
    ['Short1!', 'too_short'],
    ['alllowercaseletters', 'insufficient_classes'],
    ['Paaaass-word-2026', 'repeated_characters'],
    ['Wallet-abcd-2026-x', 'sequential_pattern'],
    ['Wallet-9876-Zq-xP', 'sequential_pattern'],
  ])('rejects %j as %s', (pw, problem) => {
    expect(passwordProblem(pw)).toBe(problem);
    expect(() => assertStrongPassword(pw)).toThrow(AgePassPasswordError);
  });

  it('accepts a strong passphrase', () => {
    expect(passwordProblem('Night-Owl-Lantern-42')).toBeNull();
    expect(() => assertStrongPassword('Night-Owl-Lantern-42')).not.toThrow();
  });
});

describe('friendly errors', () => {
  it.each([
    ['AgePass: age requirement not met', "AgePass couldn't confirm this request.", true],
    ['AgePass: credential has expired', 'Your AgePass credential has expired.', true],
    ['AgePass: this challenge was already answered', 'This request was already answered.', true],
    ['connect ECONNREFUSED 127.0.0.1:6300', 'The local proof server is not reachable.', true],
    ['Insufficient funds', 'Your wallet cannot pay the transaction fee.', true],
  ])('maps %j', (msg, title, nothingShared) => {
    const f = describeError(new Error(msg));
    expect(f.title).toBe(title);
    expect(f.nothingShared).toBe(nothingShared);
    expect(f.detail).toContain(msg);
  });

  it('falls back to the AgePass message or a generic title', () => {
    expect(describeError(new Error('AgePass: something specific')).title).toBe(
      'something specific',
    );
    expect(describeError('boom').title).toBe('Something went wrong.');
  });

  it('shows wallet (DApp Connector) errors that have an empty message', () => {
    const walletError = Object.assign(new Error(''), {
      type: 'DAppConnectorAPIError',
      code: 'InternalError',
      reason: 'Transaction balancing failed',
    });
    const f = describeError(walletError);
    expect(f.detail).toBe('Error [InternalError]: Transaction balancing failed');
    const declined = Object.assign(new Error(''), { code: 'Rejected', reason: 'User rejected' });
    expect(describeError(declined).title).toBe('The request was declined in the wallet.');
    expect(describeError(new Error('')).detail).toBe('Error: (no message)');
  });
});

describe('network config', () => {
  it('uses the documented endpoints', () => {
    expect(networkConfig('undeployed').indexer).toBe('http://127.0.0.1:8088/api/v4/graphql');
    const p = networkConfig('preview');
    expect(p.indexerWS).toBe('wss://indexer.preview.midnight.network/api/v4/graphql/ws');
    expect(p.node).toBe('https://rpc.preview.midnight.network');
    expect(networkConfig('preprod', { blockfrostProjectId: 'nightpreprodABC' }).indexer).toBe(
      'https://midnight-preprod.blockfrost.io/api/v0?project_id=nightpreprodABC',
    );
  });

  it('requires a Blockfrost token for preprod and rejects unknown networks', () => {
    expect(() => networkConfig('preprod')).toThrow(AgePassConfigError);
    expect(() => networkConfig('mainnet' as never)).toThrow(AgePassConfigError);
    expect(isAgePassNetwork('preview')).toBe(true);
    expect(isAgePassNetwork('testnet-02')).toBe(false);
  });
});
