// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// CLI configuration from .env (gitignored) with safe local defaults. Nothing secret has a
// default except the local devnet's well-known genesis seed, which only works on `undeployed`.

import { config as loadDotenv } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgePassConfigError,
  type AgePassNetwork,
  type NetworkConfig,
  isAgePassNetwork,
  networkConfig,
} from '@agepass/sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');

// npm workspace scripts run inside cli/, so load the repo-root .env explicitly.
loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true });

/** Compiler output with keys/ and zkir/, produced by `npm run compact`. */
export const ZK_ASSETS_PATH = path.join(REPO_ROOT, 'contract', 'src', 'managed', 'agepass');

/** Local, gitignored state: deployment addresses and the level private-state DB. */
export const STATE_DIR = path.join(REPO_ROOT, '.agepass');

/**
 * Seed of the wallet that receives all tokens minted in the genesis block of a local dev
 * node. Public knowledge and worthless outside `undeployed`.
 */
export const LOCAL_GENESIS_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';

export type CliConfig = NetworkConfig & {
  readonly walletSeed: string;
  readonly storagePassword: string | undefined;
};

export function loadConfig(overrideNetwork?: string): CliConfig {
  const network = overrideNetwork ?? process.env.AGEPASS_NETWORK ?? 'undeployed';
  if (!isAgePassNetwork(network)) {
    throw new AgePassConfigError(
      `AgePass: unknown network "${network}". Use undeployed, preview or preprod.`,
    );
  }
  const net = networkConfig(network, {
    ...(process.env.AGEPASS_PROOF_SERVER ? { proofServer: process.env.AGEPASS_PROOF_SERVER } : {}),
    ...(process.env.BLOCKFROST_PROJECT_ID
      ? { blockfrostProjectId: process.env.BLOCKFROST_PROJECT_ID }
      : {}),
  });
  const seed = process.env.AGEPASS_WALLET_SEED?.trim();
  if (!seed && network !== 'undeployed') {
    throw new AgePassConfigError(
      `AgePass: set AGEPASS_WALLET_SEED in .env to a funded ${network} wallet seed (hex). It is never committed.`,
    );
  }
  return {
    ...net,
    // The local devnet always uses its pre-funded genesis wallet, even if .env holds a
    // seed for a public network.
    walletSeed: network === 'undeployed' ? LOCAL_GENESIS_SEED : (seed as string),
    storagePassword: process.env.AGEPASS_PRIVATE_STATE_PASSWORD,
  };
}

type Deployment = { contractAddress: string; deployedAt: string; txId?: string };

const deploymentFile = (network: AgePassNetwork) =>
  path.join(STATE_DIR, `deployment.${network}.json`);

export function saveDeployment(network: AgePassNetwork, d: Deployment): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(deploymentFile(network), JSON.stringify(d, null, 2));
}

export function contractAddressFor(network: AgePassNetwork, explicit?: string): string {
  const addr = explicit ?? process.env.AGEPASS_CONTRACT_ADDRESS?.trim();
  if (addr) return addr;
  const f = deploymentFile(network);
  if (existsSync(f)) return (JSON.parse(readFileSync(f, 'utf8')) as Deployment).contractAddress;
  throw new AgePassConfigError(
    `AgePass: no contract address for ${network}. Run "agepass deploy" or set AGEPASS_CONTRACT_ADDRESS.`,
  );
}

export function assertZkAssetsBuilt(): void {
  if (!existsSync(path.join(ZK_ASSETS_PATH, 'keys', 'proveAge.prover'))) {
    throw new AgePassConfigError(
      'AgePass: contract keys not found. Run "npm run compact" first (needs compact 0.31.1).',
    );
  }
}
