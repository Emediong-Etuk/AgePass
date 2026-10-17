// Tool handlers and schemas. Kept apart from plugin.ts so tests can call them without starting a server.
import * as z from "zod/v4";

import { buildPaymentLink, type CreateInput, qrPng } from "./create.js";
import { errorResult } from "./errors.js";
import { type PayInput, payBase, paySolana } from "./pay.js";
import { parsePaymentLink } from "./parse.js";

const decimalString = z.string().min(1).max(80).regex(/^\s*(0|[1-9][0-9]*)(\.[0-9]+)?\s*$/, "Use a plain decimal string such as \"2\" or \"2.5\".");
const link = z.string().min(1).max(4096).describe("The full payment link, e.g. solana:... or ethereum:..., as read from the QR code. URL-encoded is fine.");

export const readInput = z.object({ link }).strict();

export const paymentRequestSchema = z.object({
  network: z.enum(["solana", "base"]),
  chain: z.enum(["solana:mainnet", "eip155:8453"]).describe("CAIP-2 chain ID."),
  recipient: z.string().describe("Full recipient address."),
  recipientShort: z.string().describe("Shortened recipient address for display."),
  token: z.enum(["SOL", "USDC", "ETH"]),
  tokenAddress: z.string().nullable().describe("Token mint (Solana) or contract (Base); null for native SOL/ETH."),
  decimals: z.number().int(),
  amount: z.string().nullable().describe("Decimal amount in token units; null if the link leaves the amount open."),
  amountAtomic: z.string().nullable().describe("Amount in the token's smallest unit (lamports, wei, or 6-decimal USDC units)."),
  label: z.string().nullable().describe("Payee name from the link (Solana only, not verified)."),
  message: z.string().nullable(),
  memo: z.string().nullable(),
  references: z.array(z.string()).describe("Solana Pay reference keys, in order."),
  summary: z.string(),
  warnings: z.array(z.string()),
  nextTool: z.enum(["pay_solana_request", "pay_base_request"]).describe("The tool to call to pay this request."),
}).strict();

export const payInput = z.object({
  link,
  amount: decimalString.optional().describe("Decimal amount in token units, e.g. \"5\" for 5 USDC. Only for links without an amount; must match if the link has one. Never invent it: ask the user."),
  maxAmount: decimalString.optional().describe("Optional safety cap in token units. The proposal is refused if the request is higher."),
});

export const paySolanaInput = payInput.extend({
  sender: z.string().min(32).max(44).describe("The user's public Solana wallet address from PayBox's granted wallet list. Never a private key or seed phrase."),
}).strict();

export const payBaseInput = payInput.extend({
  sender: z.string().max(42).optional().describe("Optional: the user's public Base wallet address, only used in the summary."),
}).strict();

export const createInput = z.object({
  network: z.enum(["solana", "base"]),
  recipient: z.string().min(1).max(64).describe("The merchant's own wallet address (base58 on Solana, 0x on Base)."),
  token: z.enum(["USDC", "SOL", "ETH"]).optional().describe("Defaults to USDC. SOL only on Solana, ETH only on Base."),
  amount: decimalString.optional().describe("Decimal amount in token units. Leave out to let the payer choose."),
  label: z.string().max(100).optional().describe("Solana only: shop or person name shown to the payer."),
  message: z.string().max(200).optional().describe("Solana only: a note shown to the payer."),
  memo: z.string().max(200).optional().describe("Solana only: recorded on-chain with the payment, e.g. an order number."),
}).strict();

export const createOutput = z.object({
  link: z.string(),
  summary: z.string(),
  qrCode: z.enum(["included", "omitted"]).describe("Whether a PNG QR code image is included in the content."),
  request: paymentRequestSchema,
}).strict();

export function readPaymentRequest({ link }: z.infer<typeof readInput>) {
  try {
    const request = parsePaymentLink(link);
    const text = [request.summary, ...request.warnings.map((warning) => `Warning: ${warning}`)].join("\n");
    return { content: [{ type: "text" as const, text }], structuredContent: request };
  } catch (error) {
    return errorResult(error);
  }
}

export function paySolanaRequest(input: PayInput) {
  try {
    return paySolana(input);
  } catch (error) {
    return errorResult(error);
  }
}

export function payBaseRequest(input: PayInput) {
  try {
    return payBase(input);
  } catch (error) {
    return errorResult(error);
  }
}

export async function createPaymentRequest(input: CreateInput) {
  let built;
  try {
    built = buildPaymentLink(input);
  } catch (error) {
    return errorResult(error);
  }
  const { link, request } = built;
  const summary = request.summary.replace(/^Pay /, "Request: pay ");
  let image: string | null = null;
  try {
    image = await qrPng(link);
  } catch (error) {
    console.error("scanpay: QR generation failed:", error instanceof Error ? error.message : String(error));
  }
  const text = `${summary}\nPayment link: ${link}\n${image ? "Show the QR code below to the payer, or send them the link." : "Send the payer this link (QR image unavailable)."}`;
  const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [{ type: "text", text }];
  if (image) content.push({ type: "image", data: image, mimeType: "image/png" });
  return {
    content,
    structuredContent: { link, summary, qrCode: image ? "included" as const : "omitted" as const, request },
  };
}
