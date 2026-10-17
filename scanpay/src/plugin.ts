import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { evmOutputSchema, solanaOutputSchema } from "./paybox.js";
import {
  createInput,
  createOutput,
  createPaymentRequest,
  payBaseInput,
  payBaseRequest,
  paySolanaInput,
  paySolanaRequest,
  paymentRequestSchema,
  readInput,
  readPaymentRequest,
} from "./tools.js";

const PROTOCOL_VERSION = "2026-07-28";
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const proposal = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

function createServer() {
  const server = new McpServer(
    { name: "scanpay", version: "1.0.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(
    "read_payment_request",
    {
      title: "Read a payment QR or link",
      description:
        "Decodes a Solana Pay (solana:...) or EIP-681 (ethereum:...) payment link, e.g. the text of a payment QR code, into plain English: recipient, amount, token, network, memo and warnings. Supports SOL and USDC on Solana mainnet, ETH and USDC on Base. No side effects. Show the summary and warnings to the user before paying, then call the tool named in nextTool.",
      inputSchema: readInput,
      outputSchema: paymentRequestSchema,
      annotations: readOnly,
    },
    async (input) => readPaymentRequest(input),
  );

  server.registerTool(
    "pay_solana_request",
    {
      title: "Pay a Solana Pay request",
      description:
        "Builds the exact unsigned Solana transaction (SOL or USDC) for a Solana Pay link, for the user to review and approve in PayBox. Does not move money by itself. sender must be the user's public Solana wallet address from PayBox's granted wallet list. Only pass amount if the link has none and the user chose it; never invent one.",
      inputSchema: paySolanaInput,
      outputSchema: solanaOutputSchema,
      annotations: proposal,
    },
    async (input) => paySolanaRequest(input),
  );

  server.registerTool(
    "pay_base_request",
    {
      title: "Pay a Base payment request",
      description:
        "Builds the exact unsigned Base transaction (ETH or USDC) for an EIP-681 ethereum: link on chain 8453, for the user to review and approve in PayBox. Does not move money by itself. Only pass amount if the link has none and the user chose it; never invent one.",
      inputSchema: payBaseInput,
      outputSchema: evmOutputSchema,
      annotations: proposal,
    },
    async (input) => payBaseRequest(input),
  );

  server.registerTool(
    "create_payment_request",
    {
      title: "Create a payment request QR",
      description:
        "For merchants and freelancers: makes a Solana Pay or Base (EIP-681) payment link for the user's own address, plus a QR code image to show customers. Defaults to USDC. Label, message and memo are Solana only. No side effects.",
      inputSchema: createInput,
      outputSchema: createOutput,
      annotations: readOnly,
    },
    async (input) => createPaymentRequest(input),
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
