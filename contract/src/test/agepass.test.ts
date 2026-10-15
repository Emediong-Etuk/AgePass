// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Executable specification of the AgePass contract. Test names read as requirements.

import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { MerkleTreePath, WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { type Ledger, pureCircuits } from '../managed/agepass/contract/index.js';
import {
  type AgePassPrivateState,
  type StoredCredential,
  AgePassWitnessError,
  createAgePassPrivateState,
} from '../witnesses.js';
import { AgePassSimulator } from './agepass.simulator.js';

// ------------------------------------------------------------------ fixtures

const key = (): Uint8Array => new Uint8Array(randomBytes(32));
const siteIdOf = (domain: string): Uint8Array => {
  // Tests only need distinct 32-byte site ids; the SDK derives real ones from the domain.
  const id = new Uint8Array(32);
  id.set(new TextEncoder().encode(domain).slice(0, 32));
  return id;
};

const TODAY = 20261015n;
const CUTOFF_18 = 20081015n; // born on or before this date => 18+ on TODAY
const EXPIRES = 20311015n;

type Actor = { sk: Uint8Array; state: AgePassPrivateState };
type Holder = Actor & { credential: StoredCredential; commitment: Uint8Array };

/** A deployed AgePass with an admin and one approved issuer. */
function setup() {
  const admin: Actor = { sk: key(), state: createAgePassPrivateState(new Uint8Array(32)) };
  admin.state = createAgePassPrivateState(admin.sk);
  const sim = new AgePassSimulator(admin.sk);

  const issuerSk = key();
  const issuer: Actor = { sk: issuerSk, state: createAgePassPrivateState(issuerSk) };
  const issuerPk = pureCircuits.issuerPublicKey(issuer.sk);
  sim.as(admin.state).addIssuer(issuerPk);

  /** Issuer verifies a person off-chain, then issues; the holder stores the credential. */
  const enrol = (birthDate: bigint, expiresOn = EXPIRES): Holder => {
    const sk = key();
    const holderPk = pureCircuits.holderPublicKey(sk);
    sim.as(issuer.state).issueCredential(birthDate, expiresOn, holderPk);
    const credential: StoredCredential = { birthDate, expiresOn, issuerPk };
    return {
      sk,
      credential,
      commitment: pureCircuits.credentialCommitment(credential, holderPk),
      state: createAgePassPrivateState(sk, credential),
    };
  };

  return { sim, admin, issuer, issuerPk, enrol };
}

let nextChallenge = 0;
const challenge = (domain = 'cornercellar.example', cutoffDate = CUTOFF_18, checkedOn = TODAY) => {
  const challengeId = new Uint8Array(32);
  challengeId[0] = ++nextChallenge & 0xff;
  challengeId[1] = (nextChallenge >> 8) & 0xff;
  challengeId.set(randomBytes(30), 2);
  return { challengeId, siteId: siteIdOf(domain), cutoffDate, checkedOn };
};

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

/** Witness override that returns a fixed Merkle path regardless of the commitment. */
const fixedPath =
  (path: MerkleTreePath<Uint8Array>) =>
  ({
    privateState,
  }: WitnessContext<Ledger, AgePassPrivateState>): [
    AgePassPrivateState,
    MerkleTreePath<Uint8Array>,
  ] => [privateState, path];

// ------------------------------------------------------------------ deployment and admin

describe('1. Deployment', () => {
  it("sets admin to the deployer's derived admin key and starts empty", () => {
    const { sim, admin } = setup();
    const l = sim.ledger();
    expect(l.admin).toEqual(pureCircuits.adminPublicKey(admin.sk));
    expect(l.credentialCount).toBe(0n);
    expect(l.verificationCount).toBe(0n);
    expect(l.verifications.isEmpty()).toBe(true);
  });

  it('never stores the admin secret, only its hash', () => {
    const { sim, admin } = setup();
    expect(sim.publicStateDump()).not.toContain(hex(admin.sk));
  });
});

describe('2. Issuer management', () => {
  it('lets the admin add an issuer', () => {
    const { sim, issuerPk } = setup();
    expect(sim.ledger().issuers.member(issuerPk)).toBe(true);
    expect(sim.ledger().issuers.size()).toBe(1n);
  });

  it('rejects addIssuer from anyone but the admin', () => {
    const { sim, issuer } = setup();
    expect(() => sim.as(issuer.state).addIssuer(key())).toThrow(
      'AgePass: only the admin can manage issuers',
    );
  });

  it('rejects removeIssuer from anyone but the admin', () => {
    const { sim, issuer, issuerPk } = setup();
    expect(() => sim.as(issuer.state).removeIssuer(issuerPk)).toThrow(
      'AgePass: only the admin can manage issuers',
    );
  });

  it('lets the admin remove an issuer', () => {
    const { sim, admin, issuerPk } = setup();
    sim.as(admin.state).removeIssuer(issuerPk);
    expect(sim.ledger().issuers.member(issuerPk)).toBe(false);
  });

  it('reports removing an issuer that is not on the list', () => {
    const { sim, admin } = setup();
    expect(() => sim.as(admin.state).removeIssuer(key())).toThrow(
      'AgePass: issuer is not on the approved list',
    );
  });
});

// ------------------------------------------------------------------ issuance

describe('3. Credential issuance', () => {
  it('lets an approved issuer issue and increments credentialCount', () => {
    const { sim, enrol } = setup();
    enrol(20000101n);
    enrol(19900620n);
    expect(sim.ledger().credentialCount).toBe(2n);
  });

  it('puts the commitment in the tree so the holder can find a path to it', () => {
    const { sim, enrol } = setup();
    const ada = enrol(20000101n);
    expect(sim.ledger().credentials.findPathForLeaf(ada.commitment)).toBeDefined();
  });

  it('rejects a caller who was never approved as issuer', () => {
    const { sim } = setup();
    const stranger = createAgePassPrivateState(key());
    expect(() => sim.as(stranger).issueCredential(20000101n, EXPIRES, key())).toThrow(
      'AgePass: caller is not an approved issuer',
    );
  });

  it('rejects an issuer after the admin removed them', () => {
    const { sim, admin, issuer, issuerPk } = setup();
    sim.as(admin.state).removeIssuer(issuerPk);
    expect(() => sim.as(issuer.state).issueCredential(20000101n, EXPIRES, key())).toThrow(
      'AgePass: caller is not an approved issuer',
    );
  });

  it('rejects a credential that expires before the birth date', () => {
    const { sim, issuer } = setup();
    expect(() => sim.as(issuer.state).issueCredential(20000101n, 19990101n, key())).toThrow(
      'AgePass: credential must expire after the birth date',
    );
  });
});

// ------------------------------------------------------------------ proving age

describe('4. Happy path', () => {
  it('records exactly siteId, cutoffDate, checkedOn and the expected nym for an adult', () => {
    const { sim, enrol } = setup();
    const ada = enrol(19950312n);
    const c = challenge();
    sim.as(ada.state).proveAge(c);

    const l = sim.ledger();
    expect(l.verificationCount).toBe(1n);
    const record = l.verifications.lookup(c.challengeId);
    expect(record).toEqual({
      siteId: c.siteId,
      nym: pureCircuits.sitePseudonym(ada.sk, c.siteId),
      cutoffDate: c.cutoffDate,
      checkedOn: c.checkedOn,
    });
  });
});

describe('5. Underage holder', () => {
  it('fails with "age requirement not met" and writes nothing', () => {
    const { sim, enrol } = setup();
    const max = enrol(20100707n); // 16 on TODAY
    const before = sim.publicStateDump();
    const c = challenge();
    expect(() => sim.as(max.state).proveAge(c)).toThrow('AgePass: age requirement not met');
    expect(sim.ledger().verifications.member(c.challengeId)).toBe(false);
    expect(sim.ledger().verificationCount).toBe(0n);
    expect(sim.publicStateDump()).toBe(before);
  });
});

describe('6. Expired credential', () => {
  it('fails when checkedOn is after expiresOn', () => {
    const { sim, enrol } = setup();
    const old = enrol(19800101n, 20261014n); // expired yesterday
    expect(() => sim.as(old.state).proveAge(challenge())).toThrow(
      'AgePass: credential has expired',
    );
  });

  it('passes on the expiry date itself', () => {
    const { sim, enrol } = setup();
    const lastDay = enrol(19800101n, TODAY);
    expect(() => sim.as(lastDay.state).proveAge(challenge())).not.toThrow();
  });
});

describe('7. Holder lies about their birth date', () => {
  it('cannot find their altered credential in the registry', () => {
    const { sim, enrol } = setup();
    const max = enrol(20100707n);
    const forged = createAgePassPrivateState(max.sk, { ...max.credential, birthDate: 20000101n });
    expect(() => sim.as(forged).proveAge(challenge())).toThrow(AgePassWitnessError);
  });

  it('fails the path binding even when supplying the path of their real credential', () => {
    const { sim, enrol } = setup();
    const max = enrol(20100707n);
    const realPath = sim.ledger().credentials.findPathForLeaf(max.commitment)!;
    const forged = createAgePassPrivateState(max.sk, { ...max.credential, birthDate: 20000101n });
    expect(() =>
      sim.as(forged).proveAge(challenge(), { credentialPath: fixedPath(realPath) }),
    ).toThrow('AgePass: credential path does not match your credential');
  });
});

describe("8. Using someone else's Merkle path", () => {
  it('fails the path-binding check', () => {
    const { sim, enrol } = setup();
    const ada = enrol(19950312n);
    const max = enrol(20100707n);
    const adaPath = sim.ledger().credentials.findPathForLeaf(ada.commitment)!;
    // Max claims an adult birth date and borrows Ada's (public) path.
    const forged = createAgePassPrivateState(max.sk, { ...max.credential, birthDate: 19950312n });
    expect(() =>
      sim.as(forged).proveAge(challenge(), { credentialPath: fixedPath(adaPath) }),
    ).toThrow('AgePass: credential path does not match your credential');
  });
});

describe('9. Self-made credential that was never issued', () => {
  it('is rejected locally because no path exists', () => {
    const { sim, enrol, issuerPk } = setup();
    enrol(19950312n);
    const sk = key();
    const fake = createAgePassPrivateState(sk, {
      birthDate: 19900101n,
      expiresOn: EXPIRES,
      issuerPk,
    });
    expect(() => sim.as(fake).proveAge(challenge())).toThrow(/not in the AgePass registry/);
  });

  it('fails checkRoot when a path is forged around the fake commitment', () => {
    const { sim, enrol, issuerPk } = setup();
    const ada = enrol(19950312n);
    const sk = key();
    const fakeCred = { birthDate: 19900101n, expiresOn: EXPIRES, issuerPk };
    const fakeCommitment = pureCircuits.credentialCommitment(
      fakeCred,
      pureCircuits.holderPublicKey(sk),
    );
    // Same siblings as a real path, but the leaf is the fake commitment => different root.
    const forgedPath = {
      ...sim.ledger().credentials.findPathForLeaf(ada.commitment)!,
      leaf: fakeCommitment,
    };
    expect(() =>
      sim
        .as(createAgePassPrivateState(sk, fakeCred))
        .proveAge(challenge(), { credentialPath: fixedPath(forgedPath) }),
    ).toThrow('AgePass: credential was never issued');
  });

  it('cannot mint itself a credential without being an approved issuer', () => {
    const { sim } = setup();
    const sk = key();
    expect(() =>
      sim
        .as(createAgePassPrivateState(sk))
        .issueCredential(19900101n, EXPIRES, pureCircuits.holderPublicKey(sk)),
    ).toThrow('AgePass: caller is not an approved issuer');
  });
});

describe('10. Replay protection', () => {
  it('refuses to answer the same challenge twice', () => {
    const { sim, enrol } = setup();
    const ada = enrol(19950312n);
    const c = challenge();
    sim.as(ada.state).proveAge(c);
    expect(() => sim.as(ada.state).proveAge(c)).toThrow(
      'AgePass: this challenge was already answered',
    );
  });

  it('refuses a different holder answering an already-answered challenge', () => {
    const { sim, enrol } = setup();
    const ada = enrol(19950312n);
    const bob = enrol(19880101n);
    const c = challenge();
    sim.as(ada.state).proveAge(c);
    expect(() => sim.as(bob.state).proveAge(c)).toThrow(
      'AgePass: this challenge was already answered',
    );
    expect(sim.ledger().verifications.lookup(c.challengeId).nym).toEqual(
      pureCircuits.sitePseudonym(ada.sk, c.siteId),
    );
  });
});

describe('11. Site pseudonyms', () => {
  it('gives the same holder the same nym on the same site', () => {
    const { sim, enrol } = setup();
    const ada = enrol(19950312n);
    const c1 = challenge('cornercellar.example');
    const c2 = challenge('cornercellar.example');
    sim.as(ada.state).proveAge(c1);
    sim.as(ada.state).proveAge(c2);
    const l = sim.ledger();
    expect(l.verifications.lookup(c1.challengeId).nym).toEqual(
      l.verifications.lookup(c2.challengeId).nym,
    );
  });

  it('gives the same holder unlinkable nyms on two different sites', () => {
    const { sim, enrol } = setup();
    const ada = enrol(19950312n);
    const c1 = challenge('cornercellar.example');
    const c2 = challenge('arcade.example');
    sim.as(ada.state).proveAge(c1);
    sim.as(ada.state).proveAge(c2);
    const l = sim.ledger();
    expect(hex(l.verifications.lookup(c1.challengeId).nym)).not.toBe(
      hex(l.verifications.lookup(c2.challengeId).nym),
    );
  });

  it('gives two holders different nyms on the same site', () => {
    const { sim, enrol } = setup();
    const ada = enrol(19950312n);
    const bob = enrol(19880101n);
    const c1 = challenge();
    const c2 = challenge();
    sim.as(ada.state).proveAge(c1);
    sim.as(bob.state).proveAge(c2);
    const l = sim.ledger();
    expect(hex(l.verifications.lookup(c1.challengeId).nym)).not.toBe(
      hex(l.verifications.lookup(c2.challengeId).nym),
    );
  });

  it('cannot be computed from the holder public key the issuer knows', () => {
    const { enrol } = setup();
    const ada = enrol(19950312n);
    const site = siteIdOf('cornercellar.example');
    const holderPk = pureCircuits.holderPublicKey(ada.sk);
    expect(hex(pureCircuits.sitePseudonym(holderPk, site))).not.toBe(
      hex(pureCircuits.sitePseudonym(ada.sk, site)),
    );
  });
});

describe('12. Historic Merkle roots', () => {
  it('accepts a path computed before more credentials were issued', () => {
    const { sim, enrol } = setup();
    const ada = enrol(19950312n);
    const stalePath = sim.ledger().credentials.findPathForLeaf(ada.commitment)!;
    const rootBefore = sim.ledger().credentials.root();
    enrol(19880101n);
    enrol(19770101n);
    expect(sim.ledger().credentials.root()).not.toEqual(rootBefore);
    expect(() =>
      sim.as(ada.state).proveAge(challenge(), { credentialPath: fixedPath(stalePath) }),
    ).not.toThrow();
  });
});

describe('13. Date boundaries', () => {
  it('passes when the birth date equals the cutoff (18th birthday today)', () => {
    const { sim, enrol } = setup();
    const h = enrol(CUTOFF_18);
    expect(() => sim.as(h.state).proveAge(challenge())).not.toThrow();
  });

  it('fails when born one day after the cutoff', () => {
    const { sim, enrol } = setup();
    const h = enrol(20081016n);
    expect(() => sim.as(h.state).proveAge(challenge())).toThrow('AgePass: age requirement not met');
  });

  it('compares across month and year boundaries correctly', () => {
    const { sim, enrol } = setup();
    // Cutoff 2008-01-01: born 2007-12-31 passes, born 2008-01-02 fails.
    const newYearsEve = enrol(20071231n);
    const janSecond = enrol(20080102n);
    expect(() => sim.as(newYearsEve.state).proveAge(challenge(undefined, 20080101n))).not.toThrow();
    expect(() => sim.as(janSecond.state).proveAge(challenge(undefined, 20080101n))).toThrow(
      'AgePass: age requirement not met',
    );
    // Cutoff 2008-03-01: born 2008-02-29 (leap day) passes, born 2008-03-02 fails.
    const leap = enrol(20080229n);
    const march = enrol(20080302n);
    expect(() => sim.as(leap.state).proveAge(challenge(undefined, 20080301n))).not.toThrow();
    expect(() => sim.as(march.state).proveAge(challenge(undefined, 20080301n))).toThrow(
      'AgePass: age requirement not met',
    );
  });
});

describe('14. Privacy regression', () => {
  it('keeps every private value out of the public ledger and the public transcript', () => {
    const { sim, enrol } = setup();
    const ada = enrol(19950312n);
    const c = challenge();
    sim.as(ada.state).proveAge(c);

    const publicState = sim.publicStateDump().toLowerCase();
    const transcript = JSON.stringify(sim.lastProofData?.publicTranscript, (_k, v) =>
      typeof v === 'bigint'
        ? v.toString()
        : v instanceof Uint8Array
          ? Buffer.from(v).toString('hex')
          : v,
    ).toLowerCase();

    const birthLE = Buffer.alloc(4);
    birthLE.writeUInt32LE(Number(ada.credential.birthDate));
    const forbidden: Record<string, string> = {
      'holder secret key': hex(ada.sk),
      'holder public key': hex(pureCircuits.holderPublicKey(ada.sk)),
      'credential commitment': hex(ada.commitment),
      'birth date (LE bytes)': birthLE.toString('hex'),
      'birth date (decimal)': ada.credential.birthDate.toString(),
    };
    for (const [what, needle] of Object.entries(forbidden)) {
      expect(publicState.includes(needle), `${what} found in public state`).toBe(false);
      expect(transcript.includes(needle), `${what} found in public transcript`).toBe(false);
    }

    // Sanity check that the search works: the disclosed nym IS present.
    expect(publicState).toContain(hex(pureCircuits.sitePseudonym(ada.sk, c.siteId)));
  });
});
