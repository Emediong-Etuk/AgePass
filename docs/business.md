# AgePass: business case

> Not legal advice. Regulatory references are general and describe direction of travel.

## Problem

Age assurance is moving from "tick a box" to "prove it". Online-safety and consumer-protection
rules in the UK, the EU, Australia and a growing number of US states push social media, adult
content, gaming, gambling, dating, alcohol and vape delivery to check ages. The default answer
today is **upload a passport or a face scan to every site**. Each site only needs a yes/no, but
ends up holding full identities, which are breached, sold, or kept forever. Users abandon flows,
and merchants take on data-protection liability they do not want.

## Solution

Verify once with an issuer that already does KYC, then answer "18+?" anywhere with a
zero-knowledge proof on Midnight. The site gets a yes and a site-specific pseudonym; no name,
no birth date, no document, and no cross-site tracking.

## Audience

| Segment                                                     | Pain                                                                                     | What AgePass gives them                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Age-gated platforms** (social, gaming, dating, forums)    | Conversion loss at ID upload; breach liability; regulators asking for "effective" checks | A yes/no with cryptographic assurance and no PII to store; per-site nym for rate limits and bans |
| **Regulated merchants** (alcohol, vapes, betting, delivery) | Checks at checkout and on delivery; storing documents                                    | Same check, reusable across visits; nothing to secure afterwards                                 |
| **Issuers** (banks, telcos, KYC providers, eID schemes)     | KYC is a cost centre                                                                     | A new revenue line from KYC they already did                                                     |
| **Adults**                                                  | Uploading IDs everywhere                                                                 | Free, one-tap, private                                                                           |

## Business model

- **Sites pay per verification** (sub-cent to a few cents, tiered by volume). The site's
  alternative is a document-check vendor at tens of cents to dollars per check, plus storage
  liability.
- **Issuers earn per issuance** (revenue share on the verifications their credentials answer,
  or a per-credential fee).
- **Free for end users.** Fees on Midnight are paid in DUST; in a production widget the site or
  a relayer can sponsor them so the user never touches tokens.

## Go-to-market

1. **Wave 1 (now):** open-source contract, SDK, CLI and reference app; local and Preview demos.
2. **Pilot:** one issuer (a KYC provider or a neobank with existing verified users) plus one
   platform with an age-gate problem (e.g. a gaming community or a craft-beer e-shop).
3. **Drop-in widget:** a "Verify with AgePass" button and a 20-line server check
   (`checkVerification`), so integration is a day, not a quarter.
4. **Issuer network:** more issuers raise the anonymity set and coverage; sites need nothing new.
5. **Beyond age:** the same pattern proves other facts: country of residence, student status,
   verified human. AgePass becomes a general "prove a fact about yourself" layer.

## Why Midnight

- **Dual ledger**: public issuer list and verification records next to private credentials and
  keys that never leave the device.
- **Selective disclosure** enforced by the compiler: every public value passes `disclose()`.
- **ZK membership with HistoricMerkleTree**: a proof hides _which_ credential was used, and old
  proofs survive new issuances.
- **Shielded fees (DUST)**: paying for a verification does not publish a NIGHT address.
- **Composability**: other Midnight dApps can read `verifications` or call the same pattern to
  gate their own circuits.

## Competition

| Approach                       | Weakness                                                           | AgePass difference                                                           |
| ------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Document upload (ID + selfie)  | Full PII at every site; friction; breach risk                      | Nothing stored by sites                                                      |
| Facial age estimation          | Biometric processing; error margins near thresholds; bias concerns | Exact threshold check on an issuer-verified date                             |
| Credit-card checks             | Excludes the unbanked; weak signal                                 | Issuer-backed date                                                           |
| Centralized digital-ID wallets | Issuer/wallet provider can observe where you prove                 | Proofs go to a public chain via the holder's device; issuer cannot link uses |
| Generic VC/SD-JWT wallets      | Selective disclosure but typically linkable presentations          | Per-site unlinkable nyms and a hidden-leaf membership proof                  |

## Metrics to watch

Verifications per day, conversion at the age gate vs. ID upload, issuer count (anonymity set),
median proof time, integration time for a new site.

## Risks

Regulatory acceptance of ZK age assurance varies by jurisdiction; credential lending is
inherent to remote checks (mitigated by per-site nym rate limits, device binding on the
roadmap); proving currently needs a local proof server, which a production wallet would bundle.
