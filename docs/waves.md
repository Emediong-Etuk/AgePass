# AgePass by Wave

## Wave 1 (this submission)

**First submission. There is no previous Wave, so nothing changed since one.**

### What was built

- **Contract** `contract/src/agepass.compact` (Compact 0.31.1, language 0.23): approved-issuer
  set, credential commitments in a `HistoricMerkleTree<16>`, single-use challenge map of
  verification records, sealed admin key, six exported pure hash circuits.
- **Simulator + 33 spec tests** covering every rule, attack and the privacy regression.
- **SDK**: typed `AgePassAPI`, challenges, site-side verifier, receipts, dates, friendly errors.
  70 tests, ~99% line coverage of the helpers.
- **CLI** with a command per role, encrypted private state, local devnet pinned to the
  compatibility matrix, `demo:local` and `e2e:local`.
- **Web app**: holder wallet, demo issuer desk, Corner Cellar demo store, public explorer;
  Lace via DApp Connector 4.0.1 (proofs generated through the wallet); browser E2E against the
  local devnet; live at <https://emediong-etuk.github.io/AgePass/>.
- **Try it without a wallet**: the whole story in the browser on the real compiled circuits and
  an in-memory ledger, for anyone without Lace or test tokens.
- **Docs**: architecture, privacy model, threat model, ADR log, business case, pitch deck,
  demo-video script, launch thread.

### Test evidence

| What                                  | Command                                            | Result                               | Evidence                                           |
| ------------------------------------- | -------------------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| Contract compiles from a clean clone  | `npm ci && npm run compact`                        | 4 circuits, 8 keys, ~28 s            | `PROGRESS.md`                                      |
| Contract spec (simulator)             | `npm test`                                         | 33/33 pass                           | CI, `contract/reports/junit.xml`                   |
| SDK                                   | `npm test`                                         | 70/70 pass                           | CI, `sdk/reports/junit.xml`                        |
| Local end-to-end with assertions      | `npm run e2e:local`                                | all checks pass, 6 real transactions | `docs/evidence/e2e-local.txt`                      |
| Every CLI command                     | `scripts/cli-smoke.sh`                             | pass                                 | `docs/evidence/cli-smoke-local.txt`                |
| Browser end-to-end (Lace test double) | `npm run e2e:ui`                                   | all checks pass                      | `docs/evidence/ui-e2e-local.txt`, `docs/img/*.png` |
| **Full story on Preview**             | `npm run e2e -w @agepass/cli -- --network preview` | all checks pass, 6 real transactions | `docs/evidence/e2e-preview.txt`                    |

### Deployment

| Network | Contract address                                                   | Explorer                                |
| ------- | ------------------------------------------------------------------ | --------------------------------------- |
| Preview | `54fc78d8890099e24fdf91f4a4f72cb231659393ee5264462b4496b9221069d2` | <https://preview.midnightexplorer.com/> |

## Wave 2 (planned)

- Drop-in **"Verify with AgePass" JS widget** and a hosted verifier endpoint.
- **Encrypted credential backup and restore**.
- **Real revocation** (revocation nullifiers or per-epoch trees), issuer-level revocation.
- Fee sponsorship so holders never need tokens.

## Wave 3 (planned)

- More predicates: residency, student status, verified human.
- Multiple production issuers; a pilot partner (one issuer, one platform).
- Device binding to raise the cost of credential lending.
