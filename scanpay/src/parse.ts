// Decodes Solana Pay transfer requests and EIP-681 payment links into plain values.
import { PublicKey } from "@solana/web3.js";
import { getAddress, isAddress } from "viem";

import { fromAtomic, parseEip681Integer, toAtomic } from "./amount.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BASE_CHAIN,
  BASE_CHAIN_ID,
  BASE_USDC_CONTRACT,
  DECIMALS,
  KNOWN_EVM_CHAINS,
  MAX_LINK_LENGTH,
  MAX_REFERENCES,
  MAX_TEXT_FIELD_BYTES,
  MEMO_PROGRAM_ID,
  NETWORK_NAME,
  type Network,
  SOLANA_CHAIN,
  SOLANA_USDC_MINT,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type TokenSymbol,
} from "./constants.js";
import { UserError } from "./errors.js";

export interface PaymentRequest {
  network: Network;
  chain: string;
  recipient: string;
  recipientShort: string;
  token: TokenSymbol;
  tokenAddress: string | null;
  decimals: number;
  amount: string | null;
  amountAtomic: string | null;
  label: string | null;
  message: string | null;
  memo: string | null;
  references: string[];
  summary: string;
  warnings: string[];
  nextTool: "pay_solana_request" | "pay_base_request";
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NOT_A_WALLET = new Set([
  SOLANA_USDC_MINT,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
]);

export function shorten(address: string): string {
  if (address.length <= 12) return address;
  const head = address.startsWith("0x") ? 6 : 4;
  return `${address.slice(0, head)}…${address.slice(-4)}`;
}

/** Validates a base58 Solana public key. Returns it unchanged, or throws a UserError naming `what`. */
export function solanaAddress(value: string, what: string): string {
  const trimmed = value.trim();
  let ok = BASE58.test(trimmed);
  if (ok) {
    try {
      ok = new PublicKey(trimmed).toBase58() === trimmed;
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    throw new UserError(
      `The ${what} "${clip(value)}" isn't a valid Solana address. A Solana address is 32 to 44 letters and numbers (base58). Check for a missing or mistyped character.`,
    );
  }
  return trimmed;
}

/** Validates a hex EVM address (checksummed or all lowercase) and returns it checksummed. */
export function evmAddress(value: string, what: string): `0x${string}` {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    if (/\.[a-z]{2,}$/i.test(trimmed)) {
      throw new UserError(
        `The ${what} "${clip(value)}" is a name (like ENS), not an address. ENS names aren't supported. Ask for the full 0x address instead.`,
      );
    }
    throw new UserError(
      `The ${what} "${clip(value)}" isn't a valid Base address. It should be 0x followed by 40 hex characters. Check for a missing or mistyped character.`,
    );
  }
  if (!isAddress(trimmed, { strict: true })) {
    throw new UserError(
      `The ${what} "${trimmed}" fails its checksum, which usually means one character is wrong. Don't pay it; ask the payee to send the address again.`,
    );
  }
  return getAddress(trimmed);
}

function clip(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}...` : value;
}

function textField(value: string | null, name: string): string | null {
  if (value === null) return null;
  if (Buffer.byteLength(value, "utf8") > MAX_TEXT_FIELD_BYTES) {
    throw new UserError(`The ${name} in this link is longer than ${MAX_TEXT_FIELD_BYTES} bytes, which ScanPay doesn't accept. Ask the payee for a shorter one.`);
  }
  return value;
}

/** Trims whitespace and undoes URL-encoding of the whole link (e.g. "solana%3A..."). */
export function normalizeLink(link: string): string {
  let value = link.trim();
  if (value.length === 0) throw new UserError("The payment link is empty. Paste the full link that starts with solana: or ethereum:.");
  if (value.length > MAX_LINK_LENGTH) throw new UserError("This payment link is too long to be a normal payment request. Check that you pasted only the link.");
  if (/^(solana|ethereum)%3A/i.test(value)) {
    try {
      value = decodeURIComponent(value).trim();
    } catch {
      throw new UserError("This payment link has broken URL-encoding. Paste the link again, exactly as the QR code or payee gave it.");
    }
  }
  return value;
}

export function parsePaymentLink(link: string): PaymentRequest {
  const value = normalizeLink(link);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme === "solana") return parseSolana(value.slice(value.indexOf(":") + 1));
  if (scheme === "ethereum") return parseEthereum(value.slice(value.indexOf(":") + 1));
  if (scheme === "http" || scheme === "https") {
    throw new UserError("This is a web link, not a payment request. ScanPay reads links that start with solana: (Solana Pay) or ethereum: (EIP-681).");
  }
  if (scheme) {
    throw new UserError(`Links starting with "${scheme}:" aren't supported. ScanPay only reads Solana Pay (solana:) links and EIP-681 (ethereum:) links for Base.`);
  }
  throw new UserError("This doesn't look like a payment link. Paste the full link that starts with solana: or ethereum:.");
}

function splitQuery(rest: string): [string, URLSearchParams] {
  const at = rest.indexOf("?");
  return at === -1 ? [rest, new URLSearchParams()] : [rest.slice(0, at), new URLSearchParams(rest.slice(at + 1))];
}

function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1) throw new UserError(`This link has more than one "${key}" value, so it's ambiguous. Ask the payee for a new link.`);
  return values[0] ?? null;
}

// ---------------------------------------------------------------- Solana Pay

function parseSolana(rest: string): PaymentRequest {
  const [rawPath, params] = splitQuery(rest);
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    // Leave it; address validation below gives the friendly error.
  }
  if (/^https?:/i.test(path) || /^https?%3a/i.test(rawPath)) {
    throw new UserError(
      "This is a Solana Pay transaction request (it points to a website that builds the payment). Transaction request links aren't supported yet. Ask the payee for a plain transfer link with their address and amount.",
    );
  }
  if (path.length === 0) throw new UserError("This Solana Pay link has no recipient address after solana:. Ask the payee for a complete link.");
  const recipient = solanaAddress(path, "recipient address");
  if (NOT_A_WALLET.has(recipient)) {
    throw new UserError(`The recipient ${recipient} is a token or program address, not a wallet. Paying it would lose the money. Don't pay this link.`);
  }

  const known = new Set(["amount", "spl-token", "reference", "label", "message", "memo"]);
  const warnings: string[] = [];
  const ignored = [...new Set([...params.keys()].filter((key) => !known.has(key)))];
  if (ignored.length) warnings.push(`Ignored parameters ScanPay doesn't use: ${ignored.join(", ")}.`);

  const splToken = single(params, "spl-token");
  let token: TokenSymbol = "SOL";
  let tokenAddress: string | null = null;
  if (splToken !== null) {
    const mint = solanaAddress(splToken, "token mint (spl-token)");
    if (mint !== SOLANA_USDC_MINT) {
      throw new UserError(
        `This link asks for a token ScanPay doesn't support (mint ${mint}). On Solana, ScanPay only pays SOL and USDC (mint ${SOLANA_USDC_MINT}). Ask the payee for a SOL or USDC link.`,
      );
    }
    token = "USDC";
    tokenAddress = SOLANA_USDC_MINT;
  }
  const decimals = DECIMALS[token];

  const rawAmount = single(params, "amount");
  let amountAtomic: bigint | null = null;
  if (rawAmount !== null) amountAtomic = toAtomic(rawAmount, decimals, token, "amount in this link");

  const references = params.getAll("reference").map((ref) => solanaAddress(ref, "reference key"));
  if (references.length > MAX_REFERENCES) {
    throw new UserError(`This link has ${references.length} reference keys; ScanPay accepts at most ${MAX_REFERENCES}. Ask the payee for a simpler link.`);
  }

  const label = textField(single(params, "label"), "label");
  const message = textField(single(params, "message"), "message");
  const memo = textField(single(params, "memo"), "memo");

  return finish({
    network: "solana", chain: SOLANA_CHAIN, recipient, token, tokenAddress, decimals,
    amountAtomic, label, message, memo, references, warnings,
  });
}

// ---------------------------------------------------------------- EIP-681

function parseEthereum(rest: string): PaymentRequest {
  const match = /^(pay-)?([^@/?]*)(?:@([^/?]*))?(?:\/([^?]*))?(?:\?(.*))?$/s.exec(rest);
  if (!match) throw new UserError("This ethereum: link isn't in a format ScanPay understands. Ask the payee for a new link.");
  const [, , targetRaw = "", chainRaw, fn, query] = match;
  if (targetRaw.length === 0) throw new UserError("This ethereum: link has no address after ethereum:. Ask the payee for a complete link.");
  let targetText = targetRaw;
  try {
    targetText = decodeURIComponent(targetRaw);
  } catch {
    // Leave it; address validation gives the friendly error.
  }
  const target = evmAddress(targetText, fn ? "token contract" : "recipient address");

  if (chainRaw === undefined || chainRaw === "") {
    throw new UserError(
      "This ethereum: link doesn't say which network it's for, and ScanPay won't guess. ScanPay only pays on Base (chain ID 8453). Confirm with the payee that it's a Base request and ask for a link that includes @8453 after the address.",
    );
  }
  if (!/^[0-9]{1,20}$/.test(chainRaw)) {
    throw new UserError(`The chain ID "${clip(chainRaw)}" in this link isn't valid. ScanPay only pays on Base (chain ID 8453).`);
  }
  if (BigInt(chainRaw) !== BASE_CHAIN_ID) {
    const id = BigInt(chainRaw).toString();
    const name = KNOWN_EVM_CHAINS[id];
    throw new UserError(
      `This request is for ${name ? `${name} (chain ID ${id})` : `chain ID ${id}`}, but ScanPay only pays on Base (chain ID 8453). Don't send it on Base: ask the payee for a Base request instead.`,
    );
  }

  const params = new URLSearchParams(query ?? "");
  const warnings: string[] = [];
  if (params.has("amount")) {
    throw new UserError(
      'This link uses a non-standard "amount" parameter whose units are unclear, so ScanPay won\'t guess. Ask the payee for a standard EIP-681 link (value in wei for ETH, or uint256 in atomic units for USDC).',
    );
  }
  for (const key of new Set(params.keys())) single(params, key);
  const gasKeys = ["gas", "gasLimit", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"].filter((key) => params.has(key));
  if (gasKeys.length) warnings.push(`The link's fee settings (${gasKeys.join(", ")}) were ignored; PayBox sets network fees.`);

  if (fn === undefined || fn === "") {
    // Native ETH payment.
    const known = new Set(["value", ...gasKeys]);
    const ignored = [...params.keys()].filter((key) => !known.has(key));
    if (ignored.length) warnings.push(`Ignored parameters ScanPay doesn't use: ${ignored.join(", ")}.`);
    if (target.toLowerCase() === BASE_USDC_CONTRACT.toLowerCase()) {
      throw new UserError("This link would send ETH straight to the USDC token contract, where it would be lost. Don't pay it; ask the payee for a corrected link.");
    }
    rejectZeroAddress(target);
    const value = single(params, "value");
    const amountAtomic = value === null ? null : parseEip681Integer(value, "ETH value (wei)");
    return finish({
      network: "base", chain: BASE_CHAIN, recipient: target, token: "ETH", tokenAddress: null, decimals: DECIMALS.ETH,
      amountAtomic, label: null, message: null, memo: null, references: [], warnings,
    });
  }

  if (fn !== "transfer") {
    throw new UserError(
      `This link asks to call the contract function "${clip(fn)}". ScanPay only handles plain ETH payments and USDC transfers on Base. Ask the payee for a simple payment link.`,
    );
  }
  if (target.toLowerCase() !== BASE_USDC_CONTRACT.toLowerCase()) {
    throw new UserError(
      `This link asks for a token ScanPay doesn't support (contract ${target}). On Base, ScanPay only pays ETH and USDC (contract ${BASE_USDC_CONTRACT}). Ask the payee for an ETH or USDC link.`,
    );
  }
  const known = new Set(["address", "uint256", "value", ...gasKeys]);
  const ignored = [...params.keys()].filter((key) => !known.has(key));
  if (ignored.length) warnings.push(`Ignored parameters ScanPay doesn't use: ${ignored.join(", ")}.`);
  const value = single(params, "value");
  if (value !== null && parseEip681Integer(value, "ETH value") !== 0n) {
    throw new UserError("This USDC transfer link also tries to send ETH, which is unusual and unsafe. Don't pay it; ask the payee for a plain USDC link.");
  }
  const to = single(params, "address");
  if (to === null) throw new UserError("This USDC transfer link doesn't say who to pay (the address parameter is missing). Ask the payee for a complete link.");
  const recipient = evmAddress(to, "recipient address");
  rejectZeroAddress(recipient);
  if (recipient.toLowerCase() === BASE_USDC_CONTRACT.toLowerCase()) {
    throw new UserError("This link would send USDC to the USDC token contract itself, where it would be lost. Don't pay it; ask the payee for a corrected link.");
  }
  const raw = single(params, "uint256");
  const amountAtomic = raw === null ? null : parseEip681Integer(raw, "USDC amount (uint256)");
  return finish({
    network: "base", chain: BASE_CHAIN, recipient, token: "USDC", tokenAddress: BASE_USDC_CONTRACT, decimals: DECIMALS.USDC,
    amountAtomic, label: null, message: null, memo: null, references: [], warnings,
  });
}

function rejectZeroAddress(address: string) {
  if (/^0x0{40}$/i.test(address)) {
    throw new UserError("This link pays the zero address (0x000…000), which would burn the money. Don't pay it.");
  }
}

// ---------------------------------------------------------------- shared

interface Draft {
  network: Network;
  chain: string;
  recipient: string;
  token: TokenSymbol;
  tokenAddress: string | null;
  decimals: number;
  amountAtomic: bigint | null;
  label: string | null;
  message: string | null;
  memo: string | null;
  references: string[];
  warnings: string[];
}

function finish(draft: Draft): PaymentRequest {
  const { amountAtomic, ...rest } = draft;
  const warnings = [...draft.warnings];
  if (amountAtomic === null) warnings.unshift("Amount not specified: you must choose one before paying.");
  else if (amountAtomic === 0n) warnings.unshift("The amount is zero, so there's nothing to pay. Ask the payee for the right amount.");
  if (draft.label !== null) {
    warnings.push(`The name "${draft.label}" comes from the link itself and isn't verified. Check the address with the payee if you're unsure.`);
  }
  if (draft.network === "solana" && draft.token === "USDC") {
    warnings.push("If the recipient has never held USDC, paying also opens their USDC account, which costs you about 0.002 SOL. You need a little SOL for fees either way.");
  }
  if (draft.network === "base") warnings.push("You need a little ETH on Base to pay the network fee.");

  const request: Omit<PaymentRequest, "summary"> = {
    ...rest,
    recipientShort: shorten(draft.recipient),
    amount: amountAtomic === null ? null : fromAtomic(amountAtomic, draft.decimals),
    amountAtomic: amountAtomic === null ? null : amountAtomic.toString(),
    warnings,
    nextTool: draft.network === "solana" ? "pay_solana_request" : "pay_base_request",
  };
  return { ...request, summary: describe(request, request.amount) };
}

/** One plain-English line naming the amount, token, recipient (short and full), network and memo. */
export function describe(request: Omit<PaymentRequest, "summary">, amount: string | null, verb = "Pay"): string {
  const what = amount === null ? `an amount you choose of ${request.token}` : `${amount} ${request.token}`;
  const who = request.label === null ? request.recipientShort : `${request.label} (${request.recipientShort})`;
  let line = `${verb} ${what} to ${who} on ${NETWORK_NAME[request.network]}`;
  if (request.memo !== null) line += `, memo: ${request.memo}`;
  if (request.message !== null) line += `, message: "${request.message}"`;
  line += `. Full recipient address: ${request.recipient}.`;
  return line;
}
