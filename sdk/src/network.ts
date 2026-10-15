// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Endpoints from docs.midnight.network "Networks and environments" (checked 15 Oct 2026).
// Midnight-hosted Preprod endpoints were retired on 9 Oct 2026; Preprod goes through
// Blockfrost and needs a project token. The proof server is always local.

export type AgePassNetwork = 'undeployed' | 'preview' | 'preprod';

export type NetworkConfig = {
  readonly networkId: AgePassNetwork;
  readonly node: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly proofServer: string;
  readonly explorer?: string;
};

export class AgePassConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgePassConfigError';
  }
}

export const DEFAULT_PROOF_SERVER = 'http://127.0.0.1:6300';

export function networkConfig(
  network: AgePassNetwork,
  opts: { proofServer?: string; blockfrostProjectId?: string } = {},
): NetworkConfig {
  const proofServer = opts.proofServer ?? DEFAULT_PROOF_SERVER;
  switch (network) {
    case 'undeployed':
      return {
        networkId: network,
        node: 'http://127.0.0.1:9944',
        indexer: 'http://127.0.0.1:8088/api/v4/graphql',
        indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
        proofServer,
      };
    case 'preview':
      return {
        networkId: network,
        node: 'https://rpc.preview.midnight.network',
        indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
        indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
        proofServer,
        explorer: 'https://preview.midnightexplorer.com',
      };
    case 'preprod': {
      const token = opts.blockfrostProjectId?.trim();
      if (!token) {
        throw new AgePassConfigError(
          'AgePass: Preprod needs a Blockfrost Midnight Preprod project ID. Set BLOCKFROST_PROJECT_ID (it starts with "nightpreprod").',
        );
      }
      const q = `?project_id=${encodeURIComponent(token)}`;
      return {
        networkId: network,
        node: `https://rpc.midnight-preprod.blockfrost.io${q}`,
        indexer: `https://midnight-preprod.blockfrost.io/api/v0${q}`,
        indexerWS: `wss://midnight-preprod.blockfrost.io/api/v0/ws${q}`,
        proofServer,
        explorer: 'https://preprod.midnightexplorer.com',
      };
    }
    default:
      throw new AgePassConfigError(
        `AgePass: unknown network "${String(network)}". Use undeployed, preview or preprod.`,
      );
  }
}

export const isAgePassNetwork = (v: unknown): v is AgePassNetwork =>
  v === 'undeployed' || v === 'preview' || v === 'preprod';
