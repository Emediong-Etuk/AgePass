# ScanPay: "pay this QR" for AI agents

A PayBox plugin (MoonPay Hackathon, **Merchant tools**). Show your agent a payment QR
code or paste a payment link and say "pay this". ScanPay decodes it into plain English
and builds the exact unsigned transaction. PayBox shows the preview, you approve with
your passkey, and PayBox signs and broadcasts. ScanPay never touches keys and never
guesses amounts.

It also works the other way: "make me a payment request for 5 USDC" returns a link
and a QR code to show customers.

**Supported:** SOL and USDC on Solana mainnet, ETH and USDC on Base (8453).
Everything else gets a clear "not supported" message.

## Tools

| Tool | What it does | Side effects |
|---|---|---|
| `read_payment_request` | Decodes a `solana:` (Solana Pay transfer request) or `ethereum:` (EIP-681) link: recipient, amount, token, network, label, message, memo, references, a summary line and warnings. | None |
| `pay_solana_request` | Builds the unsigned Solana transaction for a Solana Pay link. Needs `sender` (the user's public Solana wallet address). | Returns a proposal; PayBox asks for approval |
| `pay_base_request` | Builds the unsigned Base transaction for an EIP-681 link on chain 8453. | Returns a proposal; PayBox asks for approval |
| `create_payment_request` | Makes a Solana Pay or EIP-681 link for your own address, plus a PNG QR code. | None |

The spec's single `pay_payment_request` tool is split into `pay_solana_request` and
`pay_base_request`. The two take the same inputs and behave the same way. PayBox needs each tool's
output schema to declare one kind of proposal (Solana or EVM), so splitting is the clean way to declare both.
`read_payment_request` returns `nextTool` to say which one to call.

### What gets built

- **SOL:** one `SystemProgram.transfer`, lamports = amount × 10⁹ (exact BigInt maths).
- **USDC on Solana:** `CreateIdempotent` for the recipient's USDC account (payer = sender),
  then an SPL Memo (only if the link has a memo), then `TransferChecked` (6 decimals).
- **Solana Pay rules:** the memo goes right before the transfer, and every `reference` is added in order
  as a read-only, non-signer key on the transfer instruction.
- **Solana setup:** legacy transaction, fee payer = sender, one signer, placeholder
  blockhash `11111111111111111111111111111111` (PayBox replaces it).
- **ETH on Base:** `{ to: recipient, value: wei, data: "0x" }`.
- **USDC on Base:** `{ to: 0x8335…2913, value: "0", data: transfer(recipient, amount) }` (viem 2.51.3).
- Proposals use the starter helpers' 4-minute expiry.

### Safety rules

- It never asks for or accepts private keys or seed phrases.
- It never invents an amount. If the link has none, the agent must pass `amount`, which the user chose.
  If the link has an amount, a different `amount` is rejected.
- `maxAmount` caps the payment, and zero amounts are rejected.
- An EIP-681 link without a chain ID is refused rather than assumed to be Base.
  So are wrong chains, ENS names, bad checksums, the zero address, unknown tokens,
  contract functions other than `transfer`, non-standard `amount=` parameters and fractional wei.
- `solana:https://…` transaction requests are refused with "Transaction request links aren't supported yet".
- Labels are flagged as unverified, because they come from the link itself.
- No network calls. `node-fetch` inside `@solana/web3.js` is replaced at build time
  with a stub that refuses to connect.

## Developer portal settings

| Setting | Value |
|---|---|
| Upload | `dist/plugin.mjs` |
| Network hosts | **none** |
| Environment variables | **none** |
| Secrets | **none** |

## Test tab inputs

Paste one of these into **Test → Run test**. Replace anything in `<angle brackets>`.

**read_payment_request** (no side effects; this is also the conformance sample):

```json
{"link":"solana:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU?amount=2&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&reference=EgsmLTxqxx6B6CyfEzrxSZgG7rZADX3fcyFcxAexkF3k&label=Mama%27s%20Kitchen&message=Thanks%20for%20your%20order&memo=order-1042"}
```

```json
{"link":"ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=0x70997970C51812dc3A010C7d01b50e0d17dc79C8&uint256=1e6"}
```

An error example (no chain ID):

```json
{"link":"ethereum:0x70997970C51812dc3A010C7d01b50e0d17dc79C8?value=1e16"}
```

**create_payment_request:**

```json
{"network":"solana","recipient":"<YOUR_SOLANA_ADDRESS>","amount":"1","label":"Mama's Kitchen","memo":"order-1042"}
```

```json
{"network":"base","recipient":"<YOUR_BASE_0x_ADDRESS>","token":"USDC","amount":"5"}
```

**pay_solana_request → Validate transaction (Solana wallet).** `sender` must be the
address of the Solana wallet you pick in the validation picker. That wallet needs at least
0.01 USDC and a little SOL. The recipient can be your second wallet.

```json
{"link":"solana:<RECIPIENT_SOLANA_ADDRESS>?amount=0.01&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&label=Mama%27s%20Kitchen&memo=validate-1","sender":"<YOUR_PAYBOX_SOLANA_ADDRESS>","maxAmount":"1"}
```

If that wallet has no USDC, validate a SOL payment of 0.001 SOL instead:

```json
{"link":"solana:<RECIPIENT_SOLANA_ADDRESS>?amount=0.001&memo=validate-1","sender":"<YOUR_PAYBOX_SOLANA_ADDRESS>"}
```

**pay_base_request → Validate transaction (Base wallet).** The wallet needs at least 0.01 USDC
and a little ETH on Base:

```json
{"link":"ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=<RECIPIENT_BASE_0x_ADDRESS>&uint256=10000","maxAmount":"1"}
```

If that wallet has no USDC, validate an ETH payment of 0.000001 ETH instead:

```json
{"link":"ethereum:<RECIPIENT_BASE_0x_ADDRESS>@8453?value=1e12"}
```

Each validation result can be used once, within 5 minutes. Run the tool again for a fresh proposal.

## Develop

Requires Node.js 24 (24.21.0 for byte-identical builds) and pnpm 11.11.0.

```bash
pnpm install --frozen-lockfile
pnpm test    # PayBox starter checks: typecheck, two identical builds, conformance
pnpm unit    # ScanPay unit tests + end-to-end calls against dist/plugin.mjs
```

The unit tests decode every built transaction. On Solana they check instruction order,
program IDs, amounts, reference keys, signer and fee payer, and compare the token
instructions byte for byte with `@solana/spl-token`, which is a test-only dependency and isn't bundled.
On Base they decode the calldata. They also run create → read round trips on both networks.

Build changes from the 1.0.2 starter. The starter tooling files are otherwise unchanged.

- The `build` script adds a `createRequire` banner, because bundled CommonJS dependencies call `require("fs")`.
  It also aliases `node-fetch` to `shims/no-fetch.cjs`.
- `pnpm-workspace.yaml` denies build scripts for the optional native add-ons
  `bufferutil`, `utf-8-validate` and `bigint-buffer`. They aren't needed.

Added runtime dependencies (exact versions, all bundled): `@solana/web3.js@1.98.4`,
`viem@2.51.3`, `qrcode@1.5.4`. Token accounts are derived with
`PublicKey.findProgramAddressSync`, so the bundle doesn't include `@solana/spl-token`.
