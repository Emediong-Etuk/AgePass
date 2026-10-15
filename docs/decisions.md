# Architecture decision records

Each record: **context → decision → consequence**. Newest at the bottom.

---

## ADR-000: Toolchain, versions, endpoints (Phase 0, 15 Oct 2026)

**Context.** Compact and the Midnight SDKs change faster than any model's training data.
The build prompt asked us to re-check the official compatibility matrix before installing
anything. Preview, Preprod and Mainnet all run **ledger 8**; toolchains 0.34/0.35 and
runtimes 0.19/0.20 target ledger 9 and cannot deploy there.

**Decision.** Pin exactly to the matrix at
<https://docs.midnight.network/relnotes/support-matrix> as read on 15 Oct 2026
(identical for Preview, Preprod and Mainnet):

| Component | Pinned | Notes |
|---|---|---|
| Node (Midnight) | 1.0.400 | `midnightntwrk/midnight-node:1.0.400` for the local devnet |
| Compact devtools (`compact`) | 0.5.1 | installed from the `compact-v0.5.1` installer, not `latest` (0.5.3) |
| Compact toolchain (`compact compile`) | 0.31.1 | `compact compile --language-version` → `0.23.0` |
| `@midnight-ntwrk/compact-runtime` | 0.16.0 (exact) | |
| Compact JS / Platform JS / on-chain runtime | 2.5.1 / 2.2.4 / 3.0.0 | pulled transitively by Midnight.js 4.1.1 |
| Midnight.js (`@midnight-ntwrk/midnight-js-*`) | 4.1.1 | |
| testkit-js | 4.1.1 | |
| `@midnight-ntwrk/dapp-connector-api` | 4.0.1 | |
| `@midnight-ntwrk/wallet-sdk` | 1.2.0 (exact) | |
| `@midnight-ntwrk/ledger-v8` | 8.1.0 | override, as in the official ZK Loan example |
| Indexer | 4.3.5 (Preview) | `midnightntwrk/indexer-standalone:4.3.5`, API v4 |
| Proof server | 8.1.3 | `midnightntwrk/proof-server:8.1.3` |

The dependency set is copied from the current official `midnightntwrk/example-zkloan`
(`package.json`, Midnight.js 4.1.1), never guessed. All `@midnight-ntwrk/*` versions are
exact (no `^`).

**Pragma.** `pragma language_version 0.23;` — accepted by compactc 0.31.1 (verified by
compiling) and used by the official bulletin-board example.

**Endpoints** (from *Networks and environments*, docs.midnight.network, read 15 Oct 2026):

| Network | Node RPC | Indexer HTTP | Indexer WS |
|---|---|---|---|
| `undeployed` | `http://localhost:9944` | `http://localhost:8088/api/v4/graphql` | `ws://localhost:8088/api/v4/graphql/ws` |
| `preview` (default public) | `https://rpc.preview.midnight.network` | `https://indexer.preview.midnight.network/api/v4/graphql` | `wss://indexer.preview.midnight.network/api/v4/graphql/ws` |
| `preprod` | `https://rpc.midnight-preprod.blockfrost.io?project_id=<token>` | `https://midnight-preprod.blockfrost.io/api/v0?project_id=<token>` | `wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=<token>` |

The proof server is always local (`http://localhost:6300`). Midnight-hosted Preprod
endpoints shut down on 9 Oct 2026, so Preprod needs `BLOCKFROST_PROJECT_ID`.

**API names vs. the build prompt's reference design.** All names in the reference design
exist in compactc 0.31.1 / language 0.23: `persistentHash<T>` (generic, accepts structs),
`pad`, `merkleTreePathRoot<#n, T>`, `MerkleTreePath<#n, T>` (`leaf`, `path`),
`HistoricMerkleTree.insert` / `checkRoot` (Compact) and `findPathForLeaf` / `pathForLeaf`
(TypeScript only), `Set`, `Map`, `Counter`, `sealed ledger`. Generated TypeScript
witness signature: `(context: WitnessContext<Ledger, PS>, ...args) => [PS, result]`.

**Consequence.** Anyone with `compact` 0.5.x can reproduce the build with
`compact update 0.31.1`. Do **not** run a bare `compact update`.

**Environment note (build container only).** In the cloud build container, `compact update`
could not reach the GitHub releases API (rate limited), so the 0.31.1 compiler zip was
downloaded from the `compactc-v0.31.1` GitHub release and placed under
`~/.compact/versions/0.31.1/x86_64-unknown-linux-musl/`. The resulting
`compact compile --version` is `0.31.1`; on a normal machine `compact update 0.31.1` does
the same thing. The Midnight Kapa MCP and Midnight Expert plugins were not loadable in that
session; research used the official docs source (`midnightntwrk/midnight-docs`, commit of
13 Oct 2026) and the official examples instead.

---

## ADR-001: Issuer computes the commitment *inside* `issueCredential` (Phase 1)

**Context.** The reference design had the issuer compute the commitment off-chain and pass
only the commitment to `issueCredential(commitment)`. Then the circuit cannot check that
the `issuerPk` hashed into the credential is the issuer actually calling the circuit — an
approved issuer could mint credentials attributed to another issuer, or with an expiry
before the birth date.

**Decision.** `issueCredential(birthDate, expiresOn, holderPk)` takes the attested values
as **private circuit arguments** (circuit arguments are not public on Midnight unless
disclosed) and computes the commitment in-circuit with `issuerPublicKey(localSecretKey())`.
Only the commitment crosses `disclose()`, and only into a Merkle-tree insert, which does not
reveal the leaf.

**Consequence.** Stronger binding with no extra on-chain data. The birth date is processed by
the issuer's own proof server (the issuer already knows it, invariant 1 still holds). The SDK
still exposes `computeCommitment()` (via the exported pure circuit) so the issuer desk can
preview the commitment and the holder can locate their leaf.

## ADR-002: Commitment hash layout (Phase 1)

**Context.** The reference design hashed `[persistentHash(cred), holderPk]`.

**Decision.** Add a domain separator:
`persistentHash<Vector<3, Bytes<32>>>([pad(32, "agepass:credential:"), persistentHash<CredentialData>(cred), holderPk])`.
`persistentHash` over a struct is supported in language 0.23, so no manual field encoding is
needed.

**Consequence.** Every AgePass hash now has a distinct domain (`admin`, `issuer`, `holder`,
`nym`, `credential`), so values from one role can never be mistaken for another.

## ADR-003: Shared admin check and explicit `removeIssuer` membership (Phase 1)

**Decision.** A non-exported `assertAdmin()` circuit holds the admin check
(`"AgePass: only the admin can manage issuers"`), and `removeIssuer` asserts the issuer is on
the list first (`"AgePass: issuer is not on the approved list"`) so a typo is reported instead
of silently succeeding. `issueCredential` also asserts `birthDate < expiresOn`.

**Consequence.** One message for both admin circuits (tests match on it).
