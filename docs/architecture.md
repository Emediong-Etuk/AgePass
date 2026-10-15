# AgePass architecture

## Components

```mermaid
flowchart LR
  subgraph Device["Holder device (never shares sk or birth date)"]
    W[Wallet page / CLI holder]
    V[(Encrypted vault<br/>sk + credential)]
    PS[Local proof server :6300]
    W --- V
    W -- witnesses --> PS
  end
  subgraph Issuer["Issuer (KYC / bank / telco)"]
    ID[Issuer desk / CLI issuer]
  end
  subgraph Site["Age-gated site"]
    S[Store page / CLI site]
  end
  subgraph Midnight["Midnight network"]
    N[Node]
    IX[Indexer GraphQL v4]
    subgraph C["AgePass contract"]
      L1[admin · sealed]
      L2[issuers · Set]
      L3[credentials · HistoricMerkleTree 16]
      L4[verifications · Map challengeId → record]
    end
  end
  Lace[Lace wallet<br/>DApp Connector 4.x] -- balance + submit --> N
  W -- proveAge tx --> Lace
  ID -- issueCredential tx --> Lace
  S -- challenge (URL fragment) --> W
  S -- read record --> IX
  IX --- C
  N --- C
```

Packages:

| Package     | Role                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract/` | `agepass.compact`, witnesses, compiler output, simulator and spec tests                                                                                          |
| `sdk/`      | Environment-neutral TypeScript: `AgePassAPI` over Midnight.js, hashing via pure circuits, challenges, verifier, receipts, dates, network config, friendly errors |
| `cli/`      | Node: wallet SDK fee wallet, encrypted level private state, `agepass` commands, `demo:local`/`e2e:local`, devnet compose                                         |
| `app/`      | React + Vite: wallet, issuer desk, demo store, explorer; Lace via DApp Connector 4.0.1; keys fetched from `public/`                                              |

## Issuance

```mermaid
sequenceDiagram
  autonumber
  actor H as Holder device
  actor I as Issuer
  participant C as AgePass contract
  H->>H: sk = random 32 bytes (stays on device)
  H->>I: holderPk = H("agepass:holder:", sk)  (QR / paste)
  I->>I: check real ID off-chain (DEMO: typed date)
  I->>C: issueCredential(birthDate, expiresOn, holderPk)  [private args]
  Note over C: in-circuit: issuerPk = H(issuer sk) must be approved<br/>commitment = H(domain, H(cred), holderPk)<br/>credentials.insert(commitment)  (leaf hidden)
  I-->>H: receipt {dates, issuerPk, commitment} (privately)
  H->>C: read tree (indexer): is commitment present?
  H->>H: verify receipt: my holderPk, hash matches, leaf exists → store
```

## Verification

```mermaid
sequenceDiagram
  autonumber
  participant S as Site (store)
  actor H as Holder device
  participant P as Local proof server
  participant L as Lace
  participant C as AgePass contract
  S->>S: challenge = {random id, siteId = siteIdFor(domain), cutoff = today − 18y, checkedOn = today}
  S->>H: #/wallet?request=… (URL fragment, never sent to a server)
  H->>H: check siteId = siteIdFor(shown domain), cutoff matches minAge
  H->>H: run proveAge locally with witnesses (sk, credential, Merkle path)
  alt underage / expired / not issued / replayed
    H-->>S: nothing. Local assert fails, no proof, no transaction
  else all checks pass
    H->>P: prove (witness data stays on this machine)
    P-->>H: zk proof
    H->>L: balance fee (DUST) and submit
    L->>C: proveAge tx: discloses challengeId, siteId, nym, cutoffDate, checkedOn
    S->>C: poll verifications[challengeId] via indexer
    S->>S: checkVerification: siteId, cutoffDate, checkedOn must equal MY challenge
    S-->>H: unlocked, "Welcome, nym 0x3fa…"
  end
```

## Circuit `proveAge` in one picture

```mermaid
flowchart TD
  A[challengeId not yet answered?] -->|disclose challengeId| B
  B[commitment = H(cred, H(sk))] --> C[path = witness credentialPath(commitment)]
  C --> D{path.leaf == commitment?}
  D -->|yes| E{credentials.checkRoot(root(path))?<br/>disclose root only}
  E -->|yes| F{cred.birthDate ≤ cutoffDate?}
  F -->|yes| G{checkedOn ≤ cred.expiresOn?}
  G -->|yes| H[verifications.insert(challengeId, siteId, nym = H(sk, siteId), cutoffDate, checkedOn)]
  D -->|no| X[fail locally: nothing sent]
  E -->|no| X
  F -->|no| X
  G -->|no| X
```

## Key design choices

See `decisions.md` for the full ADR log. Highlights:

- Commitment computed **in-circuit** at issuance so the issuer key inside a credential is always
  the real issuer (ADR-001).
- Every hash TypeScript needs comes from **exported pure circuits** (`adminPublicKey`,
  `issuerPublicKey`, `holderPublicKey`, `sitePseudonym`, `credentialCommitment`, `siteIdFor`).
- `HistoricMerkleTree` so a holder's path stays valid while new credentials are issued.
- The site, not the circuit, checks that the record's dates match its own challenge.
