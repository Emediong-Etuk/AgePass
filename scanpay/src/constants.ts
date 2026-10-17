// Everything ScanPay supports. Anything not listed here is refused with a clear message.

export const SOLANA_CHAIN = "solana:mainnet";
export const BASE_CHAIN = "eip155:8453";
export const BASE_CHAIN_ID = 8453n;

export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

// PayBox replaces this with a fresh blockhash before simulation and signing.
export const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111";

export type Network = "solana" | "base";
export type TokenSymbol = "SOL" | "USDC" | "ETH";

export const DECIMALS: Record<TokenSymbol, number> = { SOL: 9, USDC: 6, ETH: 18 };

export const NETWORK_NAME: Record<Network, string> = { solana: "Solana", base: "Base" };

// Used only to make wrong-chain errors friendlier.
export const KNOWN_EVM_CHAINS: Record<string, string> = {
  "1": "Ethereum mainnet",
  "10": "Optimism",
  "56": "BNB Chain",
  "137": "Polygon",
  "324": "zkSync Era",
  "8453": "Base",
  "42161": "Arbitrum One",
  "43114": "Avalanche C-Chain",
  "59144": "Linea",
  "84532": "Base Sepolia (testnet)",
  "11155111": "Sepolia (testnet)",
};

// Bounds that keep inputs and the resulting transaction small.
export const MAX_LINK_LENGTH = 4096;
export const MAX_TEXT_FIELD_BYTES = 256;
export const MAX_REFERENCES = 8;
