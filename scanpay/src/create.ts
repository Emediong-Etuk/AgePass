// Builds Solana Pay / EIP-681 payment links (and a QR code) for merchants.
import QRCode from "qrcode";

import { fromAtomic, toAtomic } from "./amount.js";
import { BASE_USDC_CONTRACT, DECIMALS, type Network, SOLANA_USDC_MINT, type TokenSymbol } from "./constants.js";
import { UserError } from "./errors.js";
import { evmAddress, type PaymentRequest, parsePaymentLink, solanaAddress } from "./parse.js";

export interface CreateInput {
  network: Network;
  recipient: string;
  token?: TokenSymbol | undefined;
  amount?: string | undefined;
  label?: string | undefined;
  message?: string | undefined;
  memo?: string | undefined;
}

/** Strict RFC 3986 encoding, so wallets with picky parsers read the same text back. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function buildPaymentLink(input: CreateInput): { link: string; request: PaymentRequest } {
  const token: TokenSymbol = input.token ?? "USDC";
  const label = clean(input.label);
  const message = clean(input.message);
  const memo = clean(input.memo);
  const amount = clean(input.amount);

  if (input.network === "solana" && token === "ETH") {
    throw new UserError("ETH isn't available on Solana. Use token USDC or SOL for a Solana request, or network base for ETH.");
  }
  if (input.network === "base" && token === "SOL") {
    throw new UserError("SOL isn't available on Base. Use token USDC or ETH for a Base request, or network solana for SOL.");
  }
  const decimals = DECIMALS[token];
  const atomic = amount === undefined ? null : toAtomic(amount, decimals, token);
  if (atomic === 0n) throw new UserError("The amount can't be zero. Give an amount greater than zero, or leave it out so the payer chooses.");

  let link: string;
  if (input.network === "solana") {
    const recipient = solanaAddress(input.recipient, "recipient address");
    const parts: string[] = [];
    if (atomic !== null) parts.push(`amount=${fromAtomic(atomic, decimals)}`);
    if (token === "USDC") parts.push(`spl-token=${SOLANA_USDC_MINT}`);
    if (label !== undefined) parts.push(`label=${encode(label)}`);
    if (message !== undefined) parts.push(`message=${encode(message)}`);
    if (memo !== undefined) parts.push(`memo=${encode(memo)}`);
    link = `solana:${recipient}${parts.length ? `?${parts.join("&")}` : ""}`;
  } else {
    const extras = [label && "label", message && "message", memo && "memo"].filter(Boolean);
    if (extras.length) {
      throw new UserError(
        `Base (EIP-681) payment links can't carry a ${extras.join(", ")}. Remove ${extras.length > 1 ? "them" : "it"}, or create a Solana request instead.`,
      );
    }
    const recipient = evmAddress(input.recipient, "recipient address");
    if (token === "ETH") {
      link = `ethereum:${recipient}@8453${atomic === null ? "" : `?value=${atomic}`}`;
    } else {
      link = `ethereum:${BASE_USDC_CONTRACT}@8453/transfer?address=${recipient}${atomic === null ? "" : `&uint256=${atomic}`}`;
    }
  }

  // Round-trip guarantee: every link we create must read back to exactly what was asked for.
  const request = parsePaymentLink(link);
  const expected = {
    token,
    amount: atomic === null ? null : fromAtomic(atomic, decimals),
    label: label ?? null,
    message: message ?? null,
    memo: memo ?? null,
  };
  const actual = { token: request.token, amount: request.amount, label: request.label, message: request.message, memo: request.memo };
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("created link did not round-trip");
  }
  return { link, request };
}

export async function qrPng(link: string): Promise<string> {
  const png = await QRCode.toBuffer(link, { type: "png", errorCorrectionLevel: "M", margin: 2, scale: 6 });
  return png.toString("base64");
}
