# AgePass build progress

Status legend: ✅ done · 🟡 in progress · ⏸ waiting on Greg · ⬜ not started

## Phases

| Phase                         | Status | Evidence                                                                                                                                                      |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Environment and research   | ✅     | `docs/decisions.md` ADR-000; `compact compile --version` → 0.31.1, language 0.23.0                                                                            |
| 1. Contract                   | ✅     | `contract/src/agepass.compact`; clean clone → `npm ci && npm run compact` builds 4 circuits / 8 keys (~28 s)                                                  |
| 2. Simulator and tests        | ✅     | `npm test`: 33 contract spec tests + 17 date tests pass                                                                                                       |
| 3. SDK                        | ✅     | `sdk/src/*`; 67 SDK tests, 99% line / 94% branch coverage of helpers                                                                                          |
| 4. CLI and local end-to-end   | ✅     | `npm run e2e:local` all checks pass (`docs/evidence/e2e-local.txt`); every CLI subcommand smoke-tested (`docs/evidence/cli-smoke-local.txt`)                  |
| 5. Web app                    | ✅     | `npm run e2e:ui`: issuer desk issues and holder proves from Chromium against a real local node; store unlocks (`docs/evidence/ui-e2e-local.txt`, `docs/img/`) |
| 6. Preview deployment         | ⬜     | needs Greg's funded Lace wallet                                                                                                                               |
| 7. Docs, CI, licensing, pitch | ⬜     |                                                                                                                                                               |
| 8. Final verification         | ⬜     |                                                                                                                                                               |

## Hackathon requirements checklist

### Technical gate

- [x] Compact contract compiles from a clean clone with documented commands (Phase 1 gate: `git clone` → `npm ci` → `npm run compact`)
- [ ] Meaningful Midnight functionality: private state, witnesses, `disclose()` boundaries, ZK membership proof, public + private ledger data
- [ ] Original work (not a fork/copy)
- [ ] Public GitHub repo with `midnightntwrk` topic (+ `compact`, `zero-knowledge`, `privacy`, `age-verification`, `midnight`) ⏸
- [ ] Apache-2.0: `LICENSE`, `NOTICE`, SPDX headers in every source file
- [ ] Slide deck and demo video in or linked from the repo (video recorded by Greg) ⏸

### README must explain

- [ ] the project · [ ] setup · [ ] architecture · [ ] Midnight integration
- [ ] how judges can test it · [ ] how privacy shapes the design · [ ] current state
- [ ] progress this Wave · [ ] what changed since the previous Wave · [ ] evidence of testing

### Rules PDF

`docs/hackathon/rules.pdf` was **not present** in the repo at Phase 0, so no extra
requirements could be read from it. Greg: drop it into `docs/hackathon/` and any additional
requirement will be added here.

## Environment notes (Phase 0)

- Node v22.22.0, npm 10.9.4, Docker 29.8.2 (daemon started manually in the build container).
- Images pulled and pinned to the matrix: `midnight-node:1.0.400`, `indexer-standalone:4.3.5`, `proof-server:8.1.3`.
- Kapa MCP / Midnight Expert plugins were not available in the build session; research used the
  official docs source and examples (see ADR-000).
