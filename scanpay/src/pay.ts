// Builds unsigned payment proposals for PayBox. Never signs, never broadcasts, never touches keys.
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { encodeFunctionData, erc20Abi } from "viem";

import { fromAtomic, toAtomic } from "./amount.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BASE_CHAIN,
  BASE_USDC_CONTRACT,
  MEMO_PROGRAM_ID,
  PLACEHOLDER_BLOCKHASH,
  SOLANA_USDC_MINT,
  TOKEN_PROGRAM_ID,
} from "./constants.js";
import { UserError } from "./errors.js";
import { describe, evmAddress, type PaymentRequest, parsePaymentLink, shorten, solanaAddress } from "./parse.js";
import { proposeEvm, proposeSolana } from "./paybox.js";

export interface PayInput {
  link: string;
  amount?: string | undefined;
  maxAmount?: string | undefined;
  sender?: string | undefined;
}

/** Decides the exact atomic amount to pay, applying the link amount, user amount and maxAmount rules. */
export function resolveAmount(request: PaymentRequest, input: PayInput): bigint {
  const { token, decimals } = request;
  const given = input.amount === undefined ? null : toAtomic(input.amount, decimals, token, "amount you gave");
  let atomic: bigint;
  if (request.amountAtomic !== null) {
    atomic = BigInt(request.amountAtomic);
    if (given !== null && given !== atomic) {
      throw new UserError(
        `This link already sets the amount to ${request.amount} ${token}, but you asked to pay ${fromAtomic(given, decimals)} ${token}. ScanPay only pays the amount in the link. Leave the amount out, or ask the payee for a new link.`,
      );
    }
  } else {
    if (given === null) {
      throw new UserError(
        `This link doesn't include an amount, and ScanPay never guesses one. Ask the user how much ${token} to pay, then call again with the amount field (for example "5").`,
      );
    }
    atomic = given;
  }
  if (atomic === 0n) throw new UserError(`The amount is zero ${token}, so there's nothing to pay. Use an amount greater than zero.`);
  if (input.maxAmount !== undefined) {
    const cap = toAtomic(input.maxAmount, decimals, token, "maxAmount");
    if (atomic > cap) {
      throw new UserError(
        `Refused: this request is for ${fromAtomic(atomic, decimals)} ${token}, which is more than your limit of ${fromAtomic(cap, decimals)} ${token}. Nothing was proposed. Raise maxAmount only if you're sure.`,
      );
    }
  }
  return atomic;
}

function wrongNetwork(request: PaymentRequest, expected: "solana" | "base"): never {
  const other = expected === "solana" ? "pay_base_request" : "pay_solana_request";
  throw new UserError(`This is a ${request.network === "solana" ? "Solana" : "Base"} payment link. Use ${other} for it instead.`);
}

function closing(request: PaymentRequest, atomic: bigint, extra: string[]): string {
  const line = describe(request, fromAtomic(atomic, request.decimals), "Proposed: pay");
  return [line, ...extra, "Approve in PayBox to send. Nothing has been signed or sent yet; this proposal expires in 4 minutes."].join(" ");
}

// ---------------------------------------------------------------- Solana

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), new PublicKey(TOKEN_PROGRAM_ID).toBuffer(), mint.toBuffer()],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  )[0];
}

/** Builds the unsigned Solana transaction (legacy format) for a parsed request and exact amount. */
export function buildSolanaTransaction(request: PaymentRequest, senderAddress: string, atomic: bigint): Transaction {
  const sender = new PublicKey(senderAddress);
  const recipient = new PublicKey(request.recipient);
  const referenceKeys = request.references.map((ref) => ({ pubkey: new PublicKey(ref), isSigner: false, isWritable: false }));
  const tx = new Transaction({ feePayer: sender, recentBlockhash: PLACEHOLDER_BLOCKHASH });

  let transfer: TransactionInstruction;
  if (request.token === "SOL") {
    transfer = SystemProgram.transfer({ fromPubkey: sender, toPubkey: recipient, lamports: atomic });
  } else {
    const mint = new PublicKey(SOLANA_USDC_MINT);
    const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
    const source = associatedTokenAddress(sender, mint);
    const destination = associatedTokenAddress(recipient, mint);
    // (a) Create the recipient's USDC account if it doesn't exist yet; a no-op if it does.
    tx.add(new TransactionInstruction({
      programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
      keys: [
        { pubkey: sender, isSigner: true, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: recipient, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // CreateIdempotent
    }));
    // (c) TransferChecked: [12, amount u64 LE, decimals u8].
    const data = Buffer.alloc(10);
    data.writeUInt8(12, 0);
    data.writeBigUInt64LE(atomic, 1);
    data.writeUInt8(request.decimals, 9);
    transfer = new TransactionInstruction({
      programId: tokenProgram,
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: sender, isSigner: true, isWritable: false },
      ],
      data,
    });
  }
  // Solana Pay: references are read-only, non-signer keys on the transfer instruction, in order.
  transfer.keys.push(...referenceKeys);
  // (b) Solana Pay: the memo goes immediately before the transfer.
  if (request.memo !== null) {
    tx.add(new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from(request.memo, "utf8") }));
  }
  tx.add(transfer);
  return tx;
}

export function paySolana(input: PayInput) {
  const request = parsePaymentLink(input.link);
  if (request.network !== "solana") wrongNetwork(request, "solana");
  if (input.sender === undefined || input.sender.trim() === "") {
    throw new UserError("A Solana payment needs the sender: the public address of the user's Solana wallet from PayBox's granted wallet list. Never a private key or seed phrase.");
  }
  const sender = solanaAddress(input.sender, "sender wallet address");
  const atomic = resolveAmount(request, input);
  if (atomic > 2n ** 64n - 1n) throw new UserError("This amount is too large to send on Solana.");
  const tx = buildSolanaTransaction(request, sender, atomic);
  let bytes: Buffer;
  try {
    bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  } catch {
    throw new UserError("This payment is too large to fit in one Solana transaction (too many references or a very long memo). Ask the payee for a simpler link.");
  }
  if (bytes.length > 1232) {
    throw new UserError("This payment is too large to fit in one Solana transaction (too many references or a very long memo). Ask the payee for a simpler link.");
  }
  const extra: string[] = [`From ${shorten(sender)}.`];
  if (sender === request.recipient) extra.push("Note: the sender and recipient are the same wallet.");
  if (request.token === "USDC") extra.push("If the recipient has no USDC account yet, this also opens one for them (about 0.002 SOL from you).");
  const result = proposeSolana({ transactionBase64: bytes.toString("base64") });
  return { ...result, content: [{ type: "text" as const, text: closing(request, atomic, extra) }] };
}

// ---------------------------------------------------------------- Base

export function payBase(input: PayInput) {
  const request = parsePaymentLink(input.link);
  if (request.network !== "base") wrongNetwork(request, "base");
  const extra: string[] = [];
  if (input.sender !== undefined && input.sender.trim() !== "") {
    const sender = evmAddress(input.sender, "sender wallet address");
    extra.push(`From ${shorten(sender)}.`);
    if (sender.toLowerCase() === request.recipient.toLowerCase()) extra.push("Note: the sender and recipient are the same wallet.");
  }
  const atomic = resolveAmount(request, input);
  extra.push("You need a little ETH on Base for the network fee.");
  let result;
  if (request.token === "ETH") {
    result = proposeEvm({ chain: BASE_CHAIN, to: request.recipient, value: atomic.toString(), data: "0x" });
  } else {
    if (atomic >= 2n ** 256n) throw new UserError("This amount is too large to send.");
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [request.recipient as `0x${string}`, atomic],
    });
    result = proposeEvm({ chain: BASE_CHAIN, to: BASE_USDC_CONTRACT, value: "0", data });
    extra.push("PayBox's preview shows a call to the USDC contract with 0 ETH; the USDC amount and recipient are inside that call.");
  }
  return { ...result, content: [{ type: "text" as const, text: closing(request, atomic, extra) }] };
}
