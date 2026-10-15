# AgePass build progress

Status legend: ✅ done · 🟡 in progress · ⏸ waiting on Greg · ⬜ not started

## Phases

| Phase                         | Status | Evidence                                                                                                                                 |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Environment and research   | ✅     | `docs/decisions.md` ADR-000; `compact compile --version` → 0.31.1, language 0.23.0                                                       |
| 1. Contract                   | ✅     | `contract/src/agepass.compact`; clean clone → `npm ci && npm run compact` builds 4 circuits / 8 keys (~28 s)                             |
| 2. Simulator and tests        | ✅     | 33 contract spec tests + SDK date tests pass                                                                                             |
| 3. SDK                        | ✅     | `sdk/src/*`; 67 SDK tests, ~99% line / 94% branch coverage of helpers                                                                    |
| 4. CLI and local end-to-end   | ✅     | `npm run e2e:local` all checks pass (`docs/evidence/e2e-local.txt`); every CLI command (`docs/evidence/cli-smoke-local.txt`)             |
| 5. Web app                    | ✅     | `npm run e2e:ui`: issue and prove from Chromium against a real local node, store unlocks (`docs/evidence/ui-e2e-local.txt`, `docs/img/`) |
| 6. Preview deployment         | ⏸      | needs Greg's funded Lace wallet / Preview wallet seed (see "Things only Greg does")                                                      |
| 7. Docs, CI, licensing, pitch | ✅     | README, `docs/*`, `.github/workflows/ci.yml`, `docs/pitch/deck.{md,pdf}`                                                                 |
| 8. Final verification         | ✅     | fresh clone from GitHub passes compile, 100 tests, lint, licence, format, build, `e2e:local` (`docs/evidence/fresh-clone.md`); CI green  |

## Hackathon requirements checklist

### Technical gate

- [x] **Compact contract compiles from a clean clone** with documented commands: `git clone` →
      `npm ci` → `npm run compact` (verified in a fresh clone; also in CI).
- [x] **Meaningful Midnight functionality**: private state (`AgePassPrivateState`, encrypted
      level DB / browser vault), witnesses (`contract/src/witnesses.ts`), commented `disclose()`
      boundaries, ZK membership proof (`HistoricMerkleTree` + path binding), public ledger
      (`issuers`, `credentials`, `verifications`) + private data.
- [x] **Original work**: written from scratch; patterns credited in `NOTICE`.
- [ ] **Public GitHub repo with topics** `midnightntwrk`, `compact`, `zero-knowledge`, `privacy`,
      `age-verification`, `midnight` ⏸ Greg: repo `Emediong-Etuk/AgePass` exists; make it public
      and add topics.
- [x] **Apache-2.0**: `LICENSE`, `NOTICE`, SPDX headers in every source file
      (`npm run license:check`, run in CI).
- [ ] **Slide deck and demo video**: deck ✅ `docs/pitch/deck.md` + `deck.pdf`; video ⏸ Greg
      records from `docs/pitch/demo-script.md`.

### README must explain

- [x] the project (§1–2) · [x] setup (§3) · [x] architecture (§6) · [x] Midnight integration (§5)
- [x] how judges can test it (§3 a/b/c) · [x] how privacy shapes the design (§4)
- [x] current state (§9) · [x] progress this Wave (§10) · [x] what changed since previous Wave
      (§10: first Wave) · [x] evidence of testing (§8)

### Rubric extras designed for

- [x] Problem definition (README §1, `docs/business.md`)
- [x] Execution planning with milestones (`docs/waves.md`, this file)
- [x] Code quality and modularity (4 packages, strict TS, ESLint, Prettier)
- [x] Error handling and edge cases (`"AgePass: …"` asserts, `describeError`, wallet states)
- [x] Reproducible docs with examples (README quick start, expected output)
- [x] Design cohesion (navy + mint brand, shield logo, `docs/img/`)
- [x] User feedback and validation (toasts, inline errors with details, proof progress)
- [x] Demo readiness (`npm run demo:local` starts or reuses the devnet)
- [x] Version-control history (Conventional Commits, one or more per phase)
- [x] Educational clarity (commented `disclose()`s, ADRs, privacy model, architecture)
- [ ] Community engagement ⏸ Greg posts `docs/pitch/launch-thread.md`
- [x] Go-to-market and monetization (`docs/business.md`)

### Rules PDF

`docs/hackathon/rules.pdf` was **not present** in the repo, so no extra requirements could be
read from it. Greg: add it and any extra requirement will be added here.

## Environment notes

- Node v22.22.0, npm 10.9.4, Docker 29.8.2.
- Images pinned to the matrix: `midnight-node:1.0.400`, `indexer-standalone:4.3.5`,
  `proof-server:8.1.3`.
- Kapa MCP / Midnight Expert plugins were not loadable in the build session; research used the
  official docs source and examples instead (ADR-000). `/midnight-verify:verify` could not be
  run; verification was done by compiling with compactc 0.31.1, the spec tests, and real
  transactions on a local node.
