# AgePass threat model

## Assets

1. The holder's **birth date** and identity.
2. **Unlinkability** of a holder across sites, and between a verification and an issuance.
3. **Soundness**: only real, unexpired, sufficiently old credentials pass.
4. **Integrity of the issuer list.**

## Trust assumptions

| Party         | Trusted for                                                 | Not trusted for                                    |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Issuer        | Checking the real ID once and typing the correct birth date | Learning where the holder uses AgePass             |
| Admin         | Approving only legitimate issuers                           | Anything about holders (it never sees holder data) |
| Midnight      | Proof verification, ledger integrity                        | Holder data (it never receives any)                |
| Holder device | Keeping `sk` and the credential                             | n/a: it is the holder's own device                 |
| Site          | Generating fresh challenges and checking records properly   | Being honest about anything else                   |

## Attacks and mitigations

| #   | Attack                                                                               | Mitigation                                                                                                                                                                                                        | Evidence                                               |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A1  | Underage holder claims an older birth date                                           | Birth date is inside the issuer-made commitment; changing it changes the commitment, which is then not in the tree                                                                                                | spec 7 (two tests)                                     |
| A2  | Use another holder's (public) Merkle path                                            | `path.leaf == commitment` binds the path to the prover's own commitment (Midnight security guide)                                                                                                                 | spec 8                                                 |
| A3  | Self-made credential                                                                 | Only approved issuers can insert; a forged path around a fake leaf fails `checkRoot`                                                                                                                              | spec 9 (three tests)                                   |
| A4  | Non-issuer or removed issuer issues                                                  | `issuers.member(issuerPublicKey(sk))` in `issueCredential`                                                                                                                                                        | spec 3                                                 |
| A5  | Issuer attributes a credential to another issuer                                     | The commitment is computed in-circuit with the caller's own issuer key (ADR-001)                                                                                                                                  | contract code                                          |
| A6  | Non-admin edits the issuer list                                                      | `assertAdmin()`; `admin` is `sealed` (set once in the constructor)                                                                                                                                                | spec 2                                                 |
| A7  | Replay a verification                                                                | Records are keyed by `challengeId`; a second answer fails                                                                                                                                                         | spec 10                                                |
| A8  | **Client-supplied dates**: holder submits a laxer `cutoffDate` or an old `checkedOn` | The circuit only proves the holder met _the dates submitted_. The site must compare the record with the challenge it issued; `checkVerification` does this and rejects `wrong-site`, `wrong-cutoff`, `wrong-date` | SDK verifier tests                                     |
| A9  | Forged request shown to the holder (fake site name / wrong site id)                  | The wallet recomputes `siteId` from the displayed domain and the cutoff from `minAge` and rejects mismatches                                                                                                      | SDK challenge tests                                    |
| A10 | **Front-running** a challenge (someone else answers the site's challenge first)      | Requires a valid credential of one's own, so it reduces to credential lending (A11). The site sees a nym it does not recognize and can ask again.                                                                 | n/a                                                    |
| A11 | **Credential lending**: an adult proves for a minor                                  | Inherent to every remote age check, including ID upload. Mitigations: sites rate-limit per nym (a lent credential produces one recurring nym); device binding is on the roadmap                                   | n/a                                                    |
| A12 | Leaking private data on failure                                                      | Failed asserts stop local execution before proving; no transaction is created                                                                                                                                     | demo step 6/7: 0 transactions; spec 5 "writes nothing" |
| A13 | Correlating a holder across sites                                                    | `nym = H(sk, siteId)`; different sites give unrelated nyms; the issuer cannot compute nyms without `sk`                                                                                                           | spec 11                                                |
| A14 | Brute-forcing a birth date from public data                                          | Neither the date nor the commitment is public; the commitment also hashes a 256-bit-entropy holder key                                                                                                            | spec 14                                                |
| A15 | Stolen device                                                                        | Vault encrypted with a passphrase (PBKDF2-SHA256 600k + AES-GCM in the browser; Midnight.js level provider in the CLI) under the Midnight.js password policy                                                      | ADR-005                                                |

## Known limitations

- **Trusted issuer.** It knows the person ↔ holder key ↔ commitment link. It cannot link
  verifications (needs `sk` for the nym, and proofs hide the leaf). A malicious issuer could
  mint false credentials; the admin's remedy is removal, which stops new issuance.
- **Anonymity set = number of issued credentials**, further reduced by timing (verifying right
  after being issued). Small deployments give weak unlinkability.
- **Revocation.** Expiry only in Wave 1. `HistoricMerkleTree` keeps old roots valid, so a
  removed issuer's credentials keep working until they expire. Full revocation is a Wave 2 item
  (e.g. a revocation nullifier set or per-epoch trees).
- **Lost device.** No backup in Wave 1: re-issue. Encrypted backup/restore is a Wave 2 item.
- **Fee and network metadata.** See `privacy-model.md`: DUST fee payment is shielded, but
  timing, fee amount and IP address are outside AgePass's control.
- **The demo issuer is not real KYC.** It accepts a typed date and is labelled DEMO everywhere.
  It never accepts or stores ID images.
- **Proof server is local.** Proofs are generated by a proof server on the holder's machine
  (Docker). The witness data never leaves the machine, but testers must run it.
