# Changelog

All notable changes to AgePass. Format: [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - Wave 1 - 2026-10-15

First submission to the Midnight Network Buildathon.

### Added

- `agepass.compact`: issuer management, in-circuit credential commitments in a
  `HistoricMerkleTree<16>`, `proveAge` with path binding, age and expiry predicates, single-use
  challenges and site-specific pseudonyms. Pure circuits for every hash.
- Contract simulator and 33 spec tests, including a privacy regression over the serialized
  public state and transcript.
- `@agepass/sdk`: `AgePassAPI`, challenge/verifier/receipt helpers, date utilities with the
  29-February rule, network config (undeployed, preview, preprod via Blockfrost), passphrase
  policy delegated to Midnight.js, friendly error mapping. 67 tests.
- `agepass` CLI, pinned local devnet, `demo:local`, `e2e:local`, CLI smoke script.
- Web app (wallet, issuer desk, demo store, explorer) with Lace wiring and a browser E2E.
- Docs: architecture, privacy and threat models, ADRs, business case, pitch assets.
- CI: compile with Compact 0.31.1, license headers, lint, format, tests, app build.
