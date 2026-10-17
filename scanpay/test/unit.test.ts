import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SystemInstruction, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { decodeFunctionData, erc20Abi } from "viem";

import { fromAtomic, parseEip681Integer, toAtomic } from "../src/amount.js";
import { buildSolanaTransaction } from "../src/pay.js";
import { parsePaymentLink } from "../src/parse.js";
import { createPaymentRequest, payBaseRequest, paySolanaRequest, readPaymentRequest } from "../src/tools.js";

const KEY = "io.paybox/transactionProposal";
const MERCHANT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const SENDER = "4zRUfp3pKZ83JDY9qFbLerx3oo6NhGmUQfuy8GByrMBk";
const REF1 = "EgsmLTxqxx6B6CyfEzrxSZgG7rZADX3fcyFcxAexkF3k";
const REF2 = "2kHpD99u78ft65NRLgJgtVgBV1kbUB5FPgQBCtjZBBc2";
const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BASE_SENDER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const USDC_LINK =
  `solana:${MERCHANT}?amount=2&spl-token=${SOL_USDC}&reference=${REF1}&reference=${REF2}` +
  "&label=Mama%27s%20Kitchen&message=Thanks%20for%20your%20order%21&memo=order-1042";

type Result = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };

function text(result: Result): string {
  return result.content.map((block) => block.text ?? "").join("\n");
}

function expectError(result: Result, pattern: RegExp) {
  assert.equal(result.isError, true, `expected an error, got: ${text(result)}`);
  assert.equal(result.structuredContent, undefined);
  assert.match(text(result), pattern);
}

function proposal(result: Result) {
  assert.notEqual(result.isError, true, text(result));
  const value = result.structuredContent?.[KEY] as Record<string, any>;
  assert.ok(value, "missing transaction proposal");
  assert.equal(value.version, "1");
  const ttl = Date.parse(value.expiresAt) - Date.now();
  assert.ok(ttl > 200_000 && ttl <= 240_000, `expiry should be ~4 minutes, got ${ttl}ms`);
  return value;
}

function solanaTx(result: Result) {
  const value = proposal(result);
  assert.equal(value.kind, "solana");
  assert.equal(value.chain, "solana:mainnet");
  const bytes = Buffer.from(value.transaction.transactionBase64, "base64");
  assert.ok(bytes.length <= 1232);
  const versioned = VersionedTransaction.deserialize(bytes);
  assert.equal(versioned.message.header.numRequiredSignatures, 1, "exactly one signer");
  assert.equal(versioned.message.staticAccountKeys[0]?.toBase58(), SENDER, "sender is the fee payer");
  assert.equal(versioned.signatures.length, 1);
  assert.ok(versioned.signatures[0]?.every((byte) => byte === 0), "signature slot is empty");
  assert.equal(versioned.message.recentBlockhash, "11111111111111111111111111111111");
  const tx = Transaction.from(bytes);
  assert.equal(tx.feePayer?.toBase58(), SENDER);
  return tx;
}

function evmTx(result: Result) {
  const value = proposal(result);
  assert.equal(value.kind, "evm");
  assert.equal(value.chain, "eip155:8453");
  return value.transaction as { to: string; value: string; data: `0x${string}` };
}

function keys(ix: { keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] }) {
  return ix.keys.map((key) => ({ pubkey: key.pubkey.toBase58(), isSigner: key.isSigner, isWritable: key.isWritable }));
}

describe("amount maths", () => {
  test("decimal to atomic and back, exactly", () => {
    assert.equal(toAtomic("2", 6, "USDC"), 2_000_000n);
    assert.equal(toAtomic("0.000001", 6, "USDC"), 1n);
    assert.equal(toAtomic("123456789.123456789", 9, "SOL"), 123456789123456789n);
    assert.equal(fromAtomic(2_500_000n, 6), "2.5");
    assert.equal(fromAtomic(1n, 18), "0.000000000000000001");
    assert.equal(fromAtomic(0n, 6), "0");
  });
  test("EIP-681 scientific notation is exact", () => {
    assert.equal(parseEip681Integer("2.5e16", "value"), 25_000_000_000_000_000n);
    assert.equal(parseEip681Integer("1E18", "value"), 10n ** 18n);
    assert.equal(parseEip681Integer("1.000e3", "value"), 1000n);
    assert.equal(parseEip681Integer("12345678901234567890123", "value"), 12345678901234567890123n);
    assert.throws(() => parseEip681Integer("1.5", "value"), /whole number/);
    assert.throws(() => parseEip681Integer("2.55e1", "value"), /whole number/);
    assert.throws(() => parseEip681Integer("-1", "value"), /negative/);
    assert.throws(() => parseEip681Integer("0x10", "value"), /isn't a valid number/);
  });
  test("bad decimals are rejected", () => {
    assert.throws(() => toAtomic("1.1234567", 6, "USDC"), /7 decimal places, but USDC only allows 6/);
    assert.throws(() => toAtomic(".5", 6, "USDC"), /leading 0/);
    assert.throws(() => toAtomic("1,000", 6, "USDC"), /isn't a valid number/);
    assert.throws(() => toAtomic("1e3", 6, "USDC"), /isn't a valid number/);
  });
});

describe("Solana Pay: SOL", () => {
  test("reads a SOL link", () => {
    const result = readPaymentRequest({ link: `solana:${MERCHANT}?amount=0.5&label=Coffee` });
    const request = result.structuredContent as Record<string, any>;
    assert.equal(request.network, "solana");
    assert.equal(request.chain, "solana:mainnet");
    assert.equal(request.token, "SOL");
    assert.equal(request.tokenAddress, null);
    assert.equal(request.amount, "0.5");
    assert.equal(request.amountAtomic, "500000000");
    assert.equal(request.nextTool, "pay_solana_request");
    assert.match(request.summary, /^Pay 0\.5 SOL to Coffee \(7xKX…gAsU\) on Solana\. Full recipient address: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU\.$/);
  });

  test("pays a SOL link with one SystemProgram transfer", () => {
    const tx = solanaTx(paySolanaRequest({ link: `solana:${MERCHANT}?amount=0.5`, sender: SENDER }));
    assert.equal(tx.instructions.length, 1);
    const ix = tx.instructions[0]!;
    assert.ok(ix.programId.equals(SystemProgram.programId));
    const decoded = SystemInstruction.decodeTransfer(ix);
    assert.equal(decoded.fromPubkey.toBase58(), SENDER);
    assert.equal(decoded.toPubkey.toBase58(), MERCHANT);
    assert.equal(BigInt(decoded.lamports), 500_000_000n);
  });

  test("SOL with memo and references follows the Solana Pay layout", () => {
    const tx = solanaTx(paySolanaRequest({ link: `solana:${MERCHANT}?amount=1.000000001&reference=${REF1}&reference=${REF2}&memo=tip`, sender: SENDER }));
    assert.deepEqual(tx.instructions.map((ix) => ix.programId.toBase58()), [MEMO_PROGRAM, SystemProgram.programId.toBase58()]);
    assert.equal(tx.instructions[0]!.data.toString("utf8"), "tip");
    const transfer = tx.instructions[1]!;
    assert.equal(BigInt(SystemInstruction.decodeTransfer(transfer).lamports), 1_000_000_001n);
    assert.deepEqual(keys(transfer).slice(2), [
      { pubkey: REF1, isSigner: false, isWritable: false },
      { pubkey: REF2, isSigner: false, isWritable: false },
    ]);
  });

  test("large SOL amounts stay exact (no floats)", () => {
    const tx = solanaTx(paySolanaRequest({ link: `solana:${MERCHANT}?amount=9007199.254740993`, sender: SENDER }));
    assert.equal(BigInt(SystemInstruction.decodeTransfer(tx.instructions[0]!).lamports), 9_007_199_254_740_993n);
  });
});

describe("Solana Pay: USDC", () => {
  test("reads amount, two references, label, message and memo", () => {
    const request = readPaymentRequest({ link: USDC_LINK }).structuredContent as Record<string, any>;
    assert.equal(request.token, "USDC");
    assert.equal(request.tokenAddress, SOL_USDC);
    assert.equal(request.decimals, 6);
    assert.equal(request.amount, "2");
    assert.equal(request.amountAtomic, "2000000");
    assert.deepEqual(request.references, [REF1, REF2]);
    assert.equal(request.label, "Mama's Kitchen");
    assert.equal(request.message, "Thanks for your order!");
    assert.equal(request.memo, "order-1042");
    assert.equal(
      request.summary,
      `Pay 2 USDC to Mama's Kitchen (7xKX…gAsU) on Solana, memo: order-1042, message: "Thanks for your order!". Full recipient address: ${MERCHANT}.`,
    );
    assert.ok(request.warnings.some((w: string) => /isn't verified/.test(w)));
  });

  test("builds create-ATA, memo, transferChecked in that order, matching spl-token byte for byte", () => {
    const result = paySolanaRequest({ link: USDC_LINK, sender: SENDER });
    assert.match(text(result), /^Proposed: pay 2 USDC to Mama's Kitchen \(7xKX…gAsU\) on Solana, memo: order-1042/);
    assert.match(text(result), /Approve in PayBox to send\./);
    const tx = solanaTx(result);
    assert.deepEqual(tx.instructions.map((ix) => ix.programId.toBase58()), [ATA_PROGRAM, MEMO_PROGRAM, TOKEN_PROGRAM]);

    const sender = new PublicKey(SENDER);
    const merchant = new PublicKey(MERCHANT);
    const mint = new PublicKey(SOL_USDC);
    const source = getAssociatedTokenAddressSync(mint, sender);
    const destination = getAssociatedTokenAddressSync(mint, merchant, true);

    const [create, memo, transfer] = tx.instructions as [typeof tx.instructions[0], typeof tx.instructions[0], typeof tx.instructions[0]];
    const expectedCreate = createAssociatedTokenAccountIdempotentInstruction(sender, destination, merchant, mint);
    assert.deepEqual(keys(create), keys(expectedCreate));
    assert.deepEqual([...create.data], [...expectedCreate.data]);

    assert.equal(memo.data.toString("utf8"), "order-1042");
    assert.equal(memo.keys.length, 0);

    const expectedTransfer = createTransferCheckedInstruction(source, mint, destination, sender, 2_000_000n, 6);
    assert.deepEqual([...transfer.data], [...expectedTransfer.data]);
    assert.equal(transfer.data.readBigUInt64LE(1), 2_000_000n);
    assert.equal(transfer.data.readUInt8(9), 6);
    // After deserialization the fee payer is writable everywhere, so compare key order and signers here...
    const loose = (ix: Parameters<typeof keys>[0]) => keys(ix).map(({ pubkey, isSigner }) => ({ pubkey, isSigner }));
    assert.deepEqual(loose(transfer), [
      ...loose(expectedTransfer),
      { pubkey: REF1, isSigner: false },
      { pubkey: REF2, isSigner: false },
    ]);
    assert.deepEqual(keys(transfer).slice(4), [
      { pubkey: REF1, isSigner: false, isWritable: false },
      { pubkey: REF2, isSigner: false, isWritable: false },
    ]);
    // ...and the exact flags on the instructions as built, before serialization.
    const built = buildSolanaTransaction(parsePaymentLink(USDC_LINK), SENDER, 2_000_000n);
    assert.deepEqual(keys(built.instructions[0]!), keys(expectedCreate));
    assert.deepEqual(keys(built.instructions[2]!), [
      ...keys(expectedTransfer),
      { pubkey: REF1, isSigner: false, isWritable: false },
      { pubkey: REF2, isSigner: false, isWritable: false },
    ]);
  });

  test("no memo instruction when the link has no memo", () => {
    const tx = solanaTx(paySolanaRequest({ link: `solana:${MERCHANT}?amount=1&spl-token=${SOL_USDC}`, sender: SENDER }));
    assert.deepEqual(tx.instructions.map((ix) => ix.programId.toBase58()), [ATA_PROGRAM, TOKEN_PROGRAM]);
  });

  test("max references plus a long memo still fit in one transaction", () => {
    const refs = Array.from({ length: 8 }, (_, i) => `&reference=${new PublicKey(Buffer.alloc(32, i + 1)).toBase58()}`).join("");
    const memo = encodeURIComponent("x".repeat(256));
    solanaTx(paySolanaRequest({ link: `solana:${MERCHANT}?amount=1&spl-token=${SOL_USDC}${refs}&memo=${memo}`, sender: SENDER }));
  });
});

describe("open-amount links", () => {
  const open = `solana:${MERCHANT}?spl-token=${SOL_USDC}&label=Tips`;
  test("read flags the missing amount", () => {
    const request = readPaymentRequest({ link: open }).structuredContent as Record<string, any>;
    assert.equal(request.amount, null);
    assert.equal(request.amountAtomic, null);
    assert.match(request.warnings[0], /Amount not specified: you must choose one/);
    assert.match(request.summary, /^Pay an amount you choose of USDC to Tips/);
  });
  test("pay without an amount is refused, never guessed", () => {
    expectError(paySolanaRequest({ link: open, sender: SENDER }), /doesn't include an amount, and ScanPay never guesses one/);
  });
  test("pay with an amount uses exactly that amount", () => {
    const tx = solanaTx(paySolanaRequest({ link: open, sender: SENDER, amount: "3.25" }));
    assert.equal(tx.instructions.at(-1)!.data.readBigUInt64LE(1), 3_250_000n);
  });
  test("a different amount than the link's is rejected; the same amount is fine", () => {
    expectError(paySolanaRequest({ link: USDC_LINK, sender: SENDER, amount: "3" }), /already sets the amount to 2 USDC/);
    solanaTx(paySolanaRequest({ link: USDC_LINK, sender: SENDER, amount: "2.000" }));
  });
  test("zero amounts are rejected for payment", () => {
    expectError(paySolanaRequest({ link: open, sender: SENDER, amount: "0" }), /zero/);
    expectError(paySolanaRequest({ link: `solana:${MERCHANT}?amount=0`, sender: SENDER }), /zero/);
    expectError(payBaseRequest({ link: `ethereum:${BASE_RECIPIENT}@8453?value=0` }), /zero/);
  });
});

describe("EIP-681 on Base", () => {
  test("ETH link with a scientific-notation value", () => {
    const link = `ethereum:${BASE_RECIPIENT}@8453?value=2.5e16`;
    const request = readPaymentRequest({ link }).structuredContent as Record<string, any>;
    assert.equal(request.network, "base");
    assert.equal(request.chain, "eip155:8453");
    assert.equal(request.token, "ETH");
    assert.equal(request.amount, "0.025");
    assert.equal(request.amountAtomic, "25000000000000000");
    assert.equal(request.nextTool, "pay_base_request");
    const tx = evmTx(payBaseRequest({ link }));
    assert.deepEqual(tx, { to: BASE_RECIPIENT, value: "25000000000000000", data: "0x" });
  });

  test("pay- prefix and lowercase address are accepted and checksummed", () => {
    const request = parsePaymentLink(`ethereum:pay-${BASE_RECIPIENT.toLowerCase()}@8453?value=1e15`);
    assert.equal(request.recipient, BASE_RECIPIENT);
  });

  test("USDC transfer: calldata decodes to recipient and amount", () => {
    const link = `ethereum:${BASE_USDC}@8453/transfer?address=${BASE_RECIPIENT}&uint256=1.5e6`;
    const request = readPaymentRequest({ link }).structuredContent as Record<string, any>;
    assert.equal(request.token, "USDC");
    assert.equal(request.tokenAddress, BASE_USDC);
    assert.equal(request.recipient, BASE_RECIPIENT);
    assert.equal(request.amount, "1.5");
    const result = payBaseRequest({ link, sender: BASE_SENDER });
    assert.match(text(result), /^Proposed: pay 1\.5 USDC to 0x7099…79C8 on Base/);
    const tx = evmTx(result);
    assert.equal(tx.to, BASE_USDC);
    assert.equal(tx.value, "0");
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    assert.equal(decoded.functionName, "transfer");
    assert.deepEqual(decoded.args, [BASE_RECIPIENT, 1_500_000n]);
  });

  test("open-amount USDC link takes the user's amount", () => {
    const link = `ethereum:${BASE_USDC}@8453/transfer?address=${BASE_RECIPIENT}`;
    expectError(payBaseRequest({ link }), /never guesses/);
    const tx = evmTx(payBaseRequest({ link, amount: "10" }));
    assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: tx.data }).args, [BASE_RECIPIENT, 10_000_000n]);
  });

  test("missing chain ID is not assumed", () => {
    expectError(readPaymentRequest({ link: `ethereum:${BASE_RECIPIENT}?value=1e16` }), /doesn't say which network.*won't guess.*@8453/s);
    expectError(payBaseRequest({ link: `ethereum:${BASE_USDC}/transfer?address=${BASE_RECIPIENT}&uint256=1` }), /doesn't say which network/);
  });

  test("wrong chain ID is rejected with its name", () => {
    expectError(readPaymentRequest({ link: `ethereum:${BASE_RECIPIENT}@1?value=1e16` }), /Ethereum mainnet \(chain ID 1\).*only pays on Base/);
    expectError(readPaymentRequest({ link: `ethereum:${BASE_RECIPIENT}@84532?value=1e16` }), /Base Sepolia/);
    expectError(readPaymentRequest({ link: `ethereum:${BASE_RECIPIENT}@999999?value=1` }), /chain ID 999999/);
  });

  test("fractional wei is rejected", () => {
    expectError(readPaymentRequest({ link: `ethereum:${BASE_RECIPIENT}@8453?value=1.5` }), /whole number/);
  });

  test("non-standard amount parameter is not guessed", () => {
    expectError(readPaymentRequest({ link: `ethereum:${BASE_RECIPIENT}@8453?amount=0.01` }), /non-standard "amount"/);
  });
});

describe("unsupported requests", () => {
  test("unsupported Solana mint", () => {
    expectError(
      readPaymentRequest({ link: `solana:${MERCHANT}?amount=1&spl-token=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` }),
      /token ScanPay doesn't support \(mint Es9v.*only pays SOL and USDC/,
    );
  });
  test("unsupported Base token contract", () => {
    expectError(
      readPaymentRequest({ link: `ethereum:0x50c5725949a6f0c72e6c4a641f24049a917db0cb@8453/transfer?address=${BASE_RECIPIENT}&uint256=1` }),
      /token ScanPay doesn't support.*only pays ETH and USDC/,
    );
  });
  test("other contract functions", () => {
    expectError(readPaymentRequest({ link: `ethereum:${BASE_USDC}@8453/approve?address=${BASE_RECIPIENT}&uint256=1` }), /function "approve"/);
  });
  test("transaction request links", () => {
    expectError(readPaymentRequest({ link: "solana:https%3A%2F%2Fpay.example.com%2Fapi%3Forder%3D1" }), /transaction request links aren't supported yet/i);
    expectError(paySolanaRequest({ link: "solana:https://pay.example.com/api", sender: SENDER }), /transaction request links aren't supported yet/i);
  });
  test("ENS names", () => {
    expectError(readPaymentRequest({ link: "ethereum:shop.eth@8453?value=1e16" }), /ENS names aren't supported/);
  });
  test("other schemes and junk", () => {
    expectError(readPaymentRequest({ link: "bitcoin:bc1qxyz?amount=1" }), /"bitcoin:" aren't supported/);
    expectError(readPaymentRequest({ link: "https://example.com/pay" }), /web link/);
    expectError(readPaymentRequest({ link: "hello" }), /doesn't look like a payment link/);
    expectError(readPaymentRequest({ link: "   " }), /empty/);
  });
  test("wrong pay tool for the network", () => {
    expectError(payBaseRequest({ link: USDC_LINK }), /Use pay_solana_request/);
    expectError(paySolanaRequest({ link: `ethereum:${BASE_RECIPIENT}@8453?value=1e16`, sender: SENDER }), /Use pay_base_request/);
  });
});

describe("invalid addresses", () => {
  test("bad Solana recipient", () => {
    expectError(readPaymentRequest({ link: "solana:0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl?amount=1" }), /isn't a valid Solana address/);
    expectError(readPaymentRequest({ link: `solana:${MERCHANT.slice(0, -3)}?amount=1` }), /isn't a valid Solana address/);
  });
  test("bad Solana reference and sender", () => {
    expectError(readPaymentRequest({ link: `solana:${MERCHANT}?amount=1&reference=nope` }), /reference key "nope" isn't a valid Solana address/);
    expectError(paySolanaRequest({ link: USDC_LINK, sender: "not-a-wallet-address-at-all-xxxxxxxxx" }), /sender wallet address/);
    expectError(paySolanaRequest({ link: USDC_LINK, sender: "" }), /needs the sender/);
  });
  test("token mint as recipient is refused", () => {
    expectError(readPaymentRequest({ link: `solana:${SOL_USDC}?amount=1` }), /not a wallet/);
  });
  test("bad EVM checksum, length and zero address", () => {
    const bad = BASE_RECIPIENT.replace("C51812dc3A", "c51812dc3A");
    expectError(readPaymentRequest({ link: `ethereum:${bad}@8453?value=1` }), /fails its checksum/);
    expectError(readPaymentRequest({ link: "ethereum:0x1234@8453?value=1" }), /isn't a valid Base address/);
    expectError(readPaymentRequest({ link: `ethereum:${BASE_USDC}@8453/transfer?address=0x12&uint256=1` }), /recipient address "0x12" isn't a valid Base address/);
    expectError(readPaymentRequest({ link: "ethereum:0x0000000000000000000000000000000000000000@8453?value=1" }), /zero address/);
  });
});

describe("decimals and limits", () => {
  test("too many decimal places in links and inputs", () => {
    expectError(readPaymentRequest({ link: `solana:${MERCHANT}?amount=1.1234567&spl-token=${SOL_USDC}` }), /7 decimal places, but USDC only allows 6/);
    expectError(readPaymentRequest({ link: `solana:${MERCHANT}?amount=0.0000000001` }), /10 decimal places, but SOL only allows 9/);
    expectError(paySolanaRequest({ link: `solana:${MERCHANT}?spl-token=${SOL_USDC}`, sender: SENDER, amount: "1.0000001" }), /USDC only allows 6/);
  });
  test("maxAmount is respected", () => {
    expectError(paySolanaRequest({ link: USDC_LINK, sender: SENDER, maxAmount: "1.5" }), /Refused: this request is for 2 USDC, which is more than your limit of 1\.5 USDC/);
    solanaTx(paySolanaRequest({ link: USDC_LINK, sender: SENDER, maxAmount: "2" }));
    expectError(payBaseRequest({ link: `ethereum:${BASE_RECIPIENT}@8453?value=2.5e16`, maxAmount: "0.02" }), /more than your limit of 0\.02 ETH/);
    expectError(paySolanaRequest({ link: USDC_LINK, sender: SENDER, maxAmount: "1.1234567" }), /maxAmount/);
  });
  test("duplicate single-value parameters are ambiguous", () => {
    expectError(readPaymentRequest({ link: `solana:${MERCHANT}?amount=1&amount=2` }), /more than one "amount"/);
  });
});

describe("input handling", () => {
  test("URL-encoded links and surrounding whitespace are accepted", () => {
    const encoded = `  \n${encodeURIComponent(USDC_LINK)}\t `;
    const request = readPaymentRequest({ link: encoded }).structuredContent as Record<string, any>;
    assert.equal(request.label, "Mama's Kitchen");
    assert.deepEqual(request.references, [REF1, REF2]);
  });
  test("scheme is case-insensitive", () => {
    assert.equal(parsePaymentLink(`SOLANA:${MERCHANT}?amount=1`).token, "SOL");
  });
});

describe("create → read round-trips", () => {
  const roundTrip = async (input: Parameters<typeof createPaymentRequest>[0]) => {
    const result = await createPaymentRequest(input);
    assert.notEqual(result.isError, true, text(result as Result));
    const created = result.structuredContent as Record<string, any>;
    const reread = readPaymentRequest({ link: created.link }).structuredContent as Record<string, any>;
    assert.deepEqual(reread, created.request);
    return { result, created, reread };
  };

  test("Solana USDC with label, message and memo (special characters)", async () => {
    const { result, created, reread } = await roundTrip({
      network: "solana", recipient: MERCHANT, amount: "1", label: "Mama's Kitchen & Bar", message: "Thanks! 100% fresh +jollof", memo: "order #1042",
    });
    assert.match(created.link, /^solana:7xKX.*\?amount=1&spl-token=EPjF.*&label=Mama%27s%20Kitchen%20%26%20Bar&message=.*&memo=order%20%231042$/);
    assert.equal(reread.token, "USDC");
    assert.equal(reread.amount, "1");
    assert.equal(reread.label, "Mama's Kitchen & Bar");
    assert.equal(reread.message, "Thanks! 100% fresh +jollof");
    assert.equal(reread.memo, "order #1042");
    assert.equal(created.qrCode, "included");
    const image = result.content.find((block) => block.type === "image") as { data: string; mimeType: string };
    assert.equal(image.mimeType, "image/png");
    assert.equal(Buffer.from(image.data, "base64").subarray(1, 4).toString(), "PNG");
  });

  test("Solana SOL, open amount", async () => {
    const { created, reread } = await roundTrip({ network: "solana", recipient: MERCHANT, token: "SOL" });
    assert.equal(created.link, `solana:${MERCHANT}`);
    assert.equal(reread.token, "SOL");
    assert.equal(reread.amount, null);
  });

  test("Base USDC with amount", async () => {
    const { created, reread } = await roundTrip({ network: "base", recipient: BASE_RECIPIENT.toLowerCase(), amount: "5" });
    assert.equal(created.link, `ethereum:${BASE_USDC}@8453/transfer?address=${BASE_RECIPIENT}&uint256=5000000`);
    assert.equal(reread.recipient, BASE_RECIPIENT);
    assert.equal(reread.amount, "5");
  });

  test("Base ETH with amount and open-amount USDC", async () => {
    const eth = await roundTrip({ network: "base", recipient: BASE_RECIPIENT, token: "ETH", amount: "0.025" });
    assert.equal(eth.created.link, `ethereum:${BASE_RECIPIENT}@8453?value=25000000000000000`);
    const open = await roundTrip({ network: "base", recipient: BASE_RECIPIENT });
    assert.equal(open.reread.amount, null);
  });

  test("created links can be paid", async () => {
    const solana = await createPaymentRequest({ network: "solana", recipient: MERCHANT, amount: "1", label: "Mama's Kitchen", memo: "order-1" });
    const tx = solanaTx(paySolanaRequest({ link: (solana.structuredContent as any).link, sender: SENDER }));
    assert.equal(tx.instructions.at(-1)!.data.readBigUInt64LE(1), 1_000_000n);
    const base = await createPaymentRequest({ network: "base", recipient: BASE_RECIPIENT, amount: "1" });
    const evm = evmTx(payBaseRequest({ link: (base.structuredContent as any).link }));
    assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: evm.data }).args, [BASE_RECIPIENT, 1_000_000n]);
  });

  test("create rejects mismatched tokens, Solana-only fields on Base, and bad inputs", async () => {
    expectError(await createPaymentRequest({ network: "solana", recipient: MERCHANT, token: "ETH" }) as Result, /ETH isn't available on Solana/);
    expectError(await createPaymentRequest({ network: "base", recipient: BASE_RECIPIENT, token: "SOL" }) as Result, /SOL isn't available on Base/);
    expectError(await createPaymentRequest({ network: "base", recipient: BASE_RECIPIENT, memo: "x" }) as Result, /can't carry a memo/);
    expectError(await createPaymentRequest({ network: "base", recipient: MERCHANT }) as Result, /isn't a valid Base address/);
    expectError(await createPaymentRequest({ network: "solana", recipient: BASE_RECIPIENT }) as Result, /isn't a valid Solana address/);
    expectError(await createPaymentRequest({ network: "solana", recipient: MERCHANT, amount: "0" }) as Result, /can't be zero/);
    expectError(await createPaymentRequest({ network: "solana", recipient: MERCHANT, amount: "1.1234567" }) as Result, /USDC only allows 6/);
  });
});
