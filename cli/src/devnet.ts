// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Starts the local devnet if it is not already answering, so `npm run demo:local` is
// plug-and-play. Reuses a running devnet instead of restarting it.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { NetworkConfig } from '@agepass/sdk';
import { REPO_ROOT } from './config.js';
import type { Log } from './log.js';

const reachable = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return res.status < 500;
  } catch {
    return false;
  }
};

const indexerUp = (cfg: NetworkConfig) =>
  reachable(cfg.indexer.replace('/api/v4/graphql', '/ready')).then(
    async (ok) => ok || reachable(cfg.indexer),
  );

export async function ensureDevnet(cfg: NetworkConfig, log: Log): Promise<void> {
  const proofOk = await reachable(new URL('/version', cfg.proofServer).toString());
  if (proofOk && (await indexerUp(cfg))) {
    log.info('Reusing the running local devnet');
    return;
  }
  log.step('Starting local devnet (node, indexer, proof server) with Docker');
  const files = ['-f', path.join(REPO_ROOT, 'cli', 'standalone.yml')];
  // Optional extra compose file, e.g. to mount a corporate proxy CA into the proof server.
  const extra = process.env.AGEPASS_DEVNET_COMPOSE_OVERRIDE;
  if (extra) files.push('-f', extra);
  try {
    execFileSync('docker', ['compose', ...files, 'up', '-d', '--wait'], { stdio: 'inherit' });
  } catch {
    throw new Error(
      'AgePass: could not start the local devnet. Is Docker running? Try "npm run devnet:up".',
    );
  }
  for (let i = 0; i < 60; i++) {
    if (await reachable(new URL('/version', cfg.proofServer).toString())) return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('AgePass: the proof server did not become ready on port 6300.');
}
