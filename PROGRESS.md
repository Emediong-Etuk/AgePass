# AgePass build progress

Status legend: ✅ done · 🟡 in progress · ⏸ waiting on Greg · ⬜ not started

## Phases

| Phase | Status | Evidence |
|---|---|---|
| 0. Environment and research | ✅ | `docs/decisions.md` ADR-000; `compact compile --version` → 0.31.1, language 0.23.0 |
| 1. Contract | ⬜ | |
| 2. Simulator and tests | ⬜ | |
| 3. SDK | ⬜ | |
| 4. CLI and local end-to-end | ⬜ | |
| 5. Web app | ⬜ | |
| 6. Preview deployment | ⬜ | needs Greg's funded Lace wallet |
| 7. Docs, CI, licensing, pitch | ⬜ | |
| 8. Final verification | ⬜ | |

## Hackathon requirements checklist

### Technical gate
- [ ] Compact contract compiles from a clean clone with documented commands
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
