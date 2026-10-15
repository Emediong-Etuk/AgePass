# AgePass privacy model

What is public, what is private, and why. Every claim about the contract is backed by a test
(`contract/src/test/agepass.test.ts`, spec 14 "Privacy regression") or by the scripted demo,
which scans the raw serialized contract state served by the indexer
(`docs/evidence/e2e-local.txt`, section 9).

## Field by field

| Data                                                                | Where it lives                                                                     | Who can see it | On-chain?                                                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Holder secret `sk`                                                  | Holder device only (encrypted vault in the browser, encrypted level DB in the CLI) | Holder         | **Never.** Only used inside proofs.                                                                                                             |
| Holder public key `holderPk = H("agepass:holder:", sk)`             | Holder device; shown once to the issuer                                            | Holder, issuer | **Never.** Hashed into the commitment only.                                                                                                     |
| Birth date                                                          | Holder device; typed by the issuer at issuance; inside the receipt                 | Holder, issuer | **Never.** A private circuit argument of `issueCredential`; a private witness of `proveAge`.                                                    |
| Expiry date                                                         | Same as birth date                                                                 | Holder, issuer | **Never.**                                                                                                                                      |
| Issuer of a credential (`issuerPk` inside the credential)           | Holder device, inside the commitment                                               | Holder, issuer | **Not per credential.** The _set_ of approved issuers is public.                                                                                |
| Credential commitment `H("agepass:credential:", H(cred), holderPk)` | Holder device, issuer, receipt                                                     | Holder, issuer | **Not even this.** The Merkle tree stores a leaf _hash_ of it; the regression test confirms the commitment bytes do not appear in public state. |
| Merkle tree leaf hashes and roots                                   | `credentials` (HistoricMerkleTree<16>)                                             | Everyone       | Yes. Reveals how many credentials exist, not whose.                                                                                             |
| Which leaf a proof used                                             | Nowhere                                                                            | Nobody         | **No.** `proveAge` discloses only the root, which is one of the tree's public roots.                                                            |
| `credentialCount`, `verificationCount`                              | Public ledger                                                                      | Everyone       | Yes.                                                                                                                                            |
| Admin public key `H("agepass:admin:", adminSk)`                     | Public ledger (`admin`, sealed)                                                    | Everyone       | Yes: anyone can see who governs the issuer list.                                                                                                |
| Approved issuer keys                                                | Public ledger (`issuers`)                                                          | Everyone       | Yes, by design: institutions are publicly accountable.                                                                                          |
| `challengeId`                                                       | Site; public record key                                                            | Everyone       | Yes. 32 random bytes, single use.                                                                                                               |
| `siteId = siteIdFor(domain)`                                        | Public record                                                                      | Everyone       | Yes. Anyone can hash a domain, so this says _which site_ asked.                                                                                 |
| `nym = H("agepass:nym:", sk, siteId)`                               | Public record                                                                      | Everyone       | Yes. Stable for one holder on one site, unlinkable across sites, not computable from `holderPk`.                                                |
| `cutoffDate` (birth date must be ≤ this)                            | Public record                                                                      | Everyone       | Yes. Reveals the _threshold_ asked, not the birth date.                                                                                         |
| `checkedOn` (credential must not have expired by this)              | Public record                                                                      | Everyone       | Yes.                                                                                                                                            |

## Per transaction

What each circuit call puts in its public transcript (the disclosed values and ledger
operations; everything else in the proof is hidden):

| Transaction                                            | Who sends it | Public                                                                                                            | Private (proven, never revealed)                                                                     |
| ------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| deploy                                                 | Admin        | `admin` = admin public key; contract address; verifier keys                                                       | admin secret                                                                                         |
| `addIssuer(pk)` / `removeIssuer(pk)`                   | Admin        | the issuer key; that the caller knows the admin secret                                                            | admin secret                                                                                         |
| `issueCredential(birthDate, expiresOn, holderPk)`      | Issuer       | the issuing issuer's public key (set membership check); a new Merkle leaf (as a leaf hash); `credentialCount + 1` | birth date, expiry, holder key, the commitment itself, issuer secret                                 |
| `proveAge(challengeId, siteId, cutoffDate, checkedOn)` | Holder       | `challengeId`, `siteId`, `nym`, `cutoffDate`, `checkedOn`; a historic Merkle root; `verificationCount + 1`        | secret key, holder key, credential (birth date, expiry, issuer), commitment, Merkle path, which leaf |

A failed check (underage, expired, forged, replayed) fails during **local** circuit execution,
before any proof is generated. No transaction exists, so nothing reaches the chain. The demo
counts submitted transactions to show this (`transactions sent for this attempt: 0`).

## What a Midnight transaction itself exposes

Beyond the contract's own transcript, a transaction on Midnight carries:

- **The contract address and the circuit called.** An observer sees "someone called
  `proveAge` on AgePass at block time T".
- **Fees.** Fees are paid in DUST. The Midnight docs (_DUST architecture_) describe a DUST
  spend as a shielded self-spend built on the commitment/nullifier pattern: it publishes a
  nullifier, a new DUST commitment and a public declaration of the fee paid, and proves in
  zero knowledge that the input exists and the owner is unchanged. It does not publish the
  NIGHT address. However, the NIGHT→DUST **registration** is public, and fee amount plus timing
  can still be correlated.
- **Network metadata.** Like any blockchain, the node that first receives a transaction sees
  the submitter's IP address unless the user hides it.

**Consequence for holders.** AgePass never needs a holder's wallet address, and nothing in
the AgePass record identifies the fee payer. For the strongest privacy, a holder should pay
fees from a wallet that is not publicly tied to their identity. In the local demo all roles
share one fee wallet for simplicity (ADR-008); that is a demo shortcut, not a recommendation.

## Who can link what

| Party           | Knows                                                                | Cannot                                                                |
| --------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Site            | its own challenges, the holder's nym on its site, the dates it asked | the holder's name, birth date, credential, or nym on other sites      |
| Another site    | its own nym for the holder                                           | link it to the first site's nym (different `siteId` ⇒ unrelated hash) |
| Issuer          | the person ↔ `holderPk` ↔ commitment                                 | compute any nym (needs `sk`), tell which leaf a proof used            |
| Public observer | issuer list, counts, verification records                            | anything about who a nym belongs to                                   |
| Admin           | the issuer list                                                      | anything about holders                                                |

## Limits (honest list)

- **Anonymity set** = number of issued credentials (plus timing). Small deployments or a
  verification immediately after an issuance weaken unlinkability. See `threat-model.md`.
- **Same-site linkability is intended.** A site can recognize a returning user by their nym.
- **The receipt contains the birth date.** It is handed over privately (screen/QR/file) and
  never posted; treat it like the ID it replaces.
- **Revocation** is by expiry only in Wave 1. Removing an issuer stops new issuance but does not
  invalidate credentials it already issued (the holder wallet flags them).
