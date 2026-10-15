# AgePass demo video: 3-minute script

**Format:** screen recording + voice-over, 1080p. Record the web app on Preview (or the local
devnet build) in Chrome with Lace, plus a terminal for `npm run demo:local`.
**Prep:** proof server running; Lace on Preview with DUST; issuer browser profile approved;
holder profile with a fresh vault; a second "minor" holder profile with a 16-year-old DEMO
credential; Corner Cellar request not yet started. Close other tabs; zoom browser to 110%.

| Time      | Shot                                                                                                                                                                                    | Voice-over                                                                                                                                                                                                                                                             | On-screen text                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 0:00–0:10 | **Hook.** Landing page, slow scroll to "What sites learn / never learn"                                                                                                                 | "To buy a bottle of wine online, you're about to hand a stranger your passport. What if you could just prove you're over 18, and nothing else?"                                                                                                                        | Prove you're 18+. Not who you are.            |
| 0:10–0:30 | **Problem.** Static slide 2 of the deck                                                                                                                                                 | "Age-check laws are spreading. Today that means uploading IDs to every site, and every site becomes a honeypot of identities. The site only needed a yes or a no."                                                                                                     | Sites need a yes. They get your identity.     |
| 0:30–0:50 | **Issuance.** Holder wallet: create key, show QR. Switch to issuer desk (DEMO banner visible), paste key, type DEMO birth date, show commitment preview, click Issue, progress, receipt | "I verify once with an issuer, here a demo KYC desk. My device makes a secret key and shows only its public part. The issuer records a commitment on Midnight. Not my birth date: a hash that even hides which leaf it is."                                            | DEMO issuer · only a commitment goes on-chain |
| 0:50–1:00 | Holder imports receipt; credential card with birth date hidden                                                                                                                          | "My wallet checks the receipt is mine and really is on-chain."                                                                                                                                                                                                         | Credential stays on this device               |
| 1:00–1:35 | **Prove.** Corner Cellar locked → Verify with AgePass → approve screen (read the learn / not-learn boxes) → Approve → progress steps with timer → Confirmed → Return                    | "Corner Cellar asks: are you 18? My wallet tells me exactly what they'll learn: yes, and a nickname for this store. Not my name, not my birth date. Approve. My device generates a zero-knowledge proof with a local proof server, Lace pays a tiny fee in DUST, and…" | Generating zero-knowledge proof…              |
| 1:35–1:55 | **Unlock + public record.** Store unlocks "Welcome, nym 0x…"; zoom on the side panel                                                                                                    | "…the store unlocks. This panel is the exact public record: the store's id, my nickname here, and the two dates it asked about. That's all anyone on the chain can see."                                                                                               | This is everything on-chain                   |
| 1:55–2:15 | **Underage.** Minor profile → same store → "AgePass couldn't confirm this request"                                                                                                      | "A 16-year-old tries. The check fails on their own device, before a proof exists. Nothing is shared, no transaction is sent."                                                                                                                                          | Blocked on-device · 0 transactions            |
| 2:15–2:35 | **Second site, different nym.** Terminal: `npm run demo:local` already run, scroll to step 8 and step 9                                                                                 | "The scripted demo shows the same person on a second site gets a different, unlinkable nickname, and then scans the raw public state: no birth dates, no keys."                                                                                                        | Different site ⇒ different nym                |
| 2:35–2:50 | **Privacy + Midnight.** Deck slide 6                                                                                                                                                    | "This works because Midnight has a public and a private ledger, compiler-checked disclose boundaries, and Merkle-tree membership proofs that hide which credential you used."                                                                                          | Dual ledger · disclose() · ZK membership      |
| 2:50–3:00 | **Close.** Deck last slide with repo URL                                                                                                                                                | "AgePass. Prove you're 18, not who you are. The code, tests and docs are open source. We're looking for an issuer and a platform to pilot with."                                                                                                                       | github.com/Emediong-Etuk/AgePass              |

## Shot list

1. Landing page (desktop), scroll.
2. Deck slide 2 (problem).
3. Holder wallet: create vault → generate key → QR.
4. Issuer desk: DEMO banner, paste holder key, birth date, commitment preview, Issue, progress, receipt.
5. Holder: import receipt, credential card, toggle "show" then "hide".
6. Corner Cellar locked grid → Verify with AgePass.
7. Approve screen (hold 3 s on the learn / not-learn boxes) → Approve → progress → Confirmed.
8. Store unlocked + public record panel (zoom).
9. Minor profile: blocked message.
10. Terminal: `npm run demo:local` output, steps 8–9.
11. Deck slide 6, then last slide.

## Recording tips

- Proofs take ~25–60 s: keep recording, then cut the wait to 3–4 s with a visible timer jump.
- Never show a real birth date or a real wallet seed. All dates must be DEMO values.
- Upload as YouTube (unlisted) or Loom and paste the link into `README.md` ("Demo video").
