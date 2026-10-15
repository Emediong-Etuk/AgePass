#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// `agepass` command line: one subcommand per role. Run with `npm run agepass -- <command>`.

import { readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import {
  type AgePassNetwork,
  AgePassConfigError,
  computeHolderPk,
  computeIssuerPk,
  createAgePassPrivateState,
  createChallenge,
  createReceipt,
  evaluateLedger,
  formatIsoDate,
  fromHex,
  ledgerReader,
  parseChallenge,
  parseIsoDate,
  parseReceipt,
  randomBytes32,
  shortHex,
  toHex,
  verifyReceipt,
  waitForVerification,
} from '@agepass/sdk';
import { contractAddressFor, loadConfig, saveDeployment } from './config.js';
import { c, log, quietNetworkNoise, reportError } from './log.js';
import { assertProofServer, openSession, publicData, readLedgerOrThrow } from './session.js';
import { ensureFeesReady, startWallet, stopWallet, walletSummary } from './wallet.js';

quietNetworkNoise();

const program = new Command()
  .name('agepass')
  .description('AgePass: prove you are over 18 without showing your ID (Midnight).')
  .option('-n, --network <network>', 'undeployed | preview | preprod (default: AGEPASS_NETWORK)')
  .option('-c, --contract <address>', 'AgePass contract address (default: last deployment)');

const cfg = () => loadConfig(program.opts<{ network?: string }>().network);
const address = () =>
  contractAddressFor(
    cfg().networkId as AgePassNetwork,
    program.opts<{ contract?: string }>().contract,
  );

function password(): string {
  const p = cfg().storagePassword;
  if (!p) {
    throw new AgePassConfigError(
      'AgePass: set AGEPASS_PRIVATE_STATE_PASSWORD in .env. It encrypts your AgePass keys on disk.',
    );
  }
  return p;
}

/** Runs `f` with a wallet-backed session and always shuts the wallet down. */
async function withSession<T>(f: (s: Awaited<ReturnType<typeof openSession>>) => Promise<T>) {
  const config = cfg();
  await assertProofServer(config);
  const s = await openSession(config, log, { storagePassword: password() });
  try {
    return await f(s);
  } finally {
    await s.close();
  }
}

const readJson = (fileOrJson: string): string =>
  fileOrJson.trim().startsWith('{') ? fileOrJson : readFileSync(fileOrJson, 'utf8');

const holderId = (name: string) => `holder:${name}`;

// ── wallet ───────────────────────────────────────────────────────────────────────────
program
  .command('wallet')
  .description('Show the fee wallet address (for the faucet) and its NIGHT/DUST balances')
  .option('--wait', 'keep syncing until NIGHT arrives (e.g. after using the faucet)')
  .option('--prepare', 'register NIGHT for DUST generation and wait until DUST is available')
  .action(async (o: { wait?: boolean; prepare?: boolean }) => {
    const config = cfg();
    const ctx = await startWallet(config, config.walletSeed);
    try {
      log.kv('network', config.networkId);
      log.kv('address', ctx.unshieldedKeystore.getBech32Address().asString());
      log.step('Syncing (can take a few minutes on a public network)…');
      if (o.wait) await walletSummary(ctx, { waitForNight: true });
      if (o.prepare) await ensureFeesReady(ctx, log);
      const s = await walletSummary(ctx);
      log.kv('NIGHT', String(s.night));
      log.kv('DUST', String(s.dust));
    } finally {
      await stopWallet(ctx);
    }
  });

// ── deploy ───────────────────────────────────────────────────────────────────────────
program
  .command('deploy')
  .description('Deploy a new AgePass contract; your new admin key is kept in private state')
  .action(() =>
    withSession(async (s) => {
      const api = await s.deploy(createAgePassPrivateState(randomBytes32()), 'admin');
      saveDeployment(cfg().networkId, {
        contractAddress: api.contractAddress,
        deployedAt: new Date().toISOString(),
      });
      log.ok(`Deployed AgePass at ${c.bold(api.contractAddress)}`);
      const explorer = cfg().explorer;
      if (explorer) log.info(`Explorer: ${explorer}`);
    }),
  );

// ── admin ────────────────────────────────────────────────────────────────────────────
const admin = program.command('admin').description('Manage the approved issuer list');
for (const [name, verb] of [
  ['add-issuer', 'addIssuer'],
  ['remove-issuer', 'removeIssuer'],
] as const) {
  admin
    .command(`${name} <issuerPk>`)
    .description(`${verb === 'addIssuer' ? 'Approve' : 'Remove'} an issuer public key (hex)`)
    .action((pk: string) =>
      withSession(async (s) => {
        const api = await s.join(address(), 'admin');
        const tx = await api[verb](fromHex(pk, 32, 'issuer key'));
        log.ok(`${verb} confirmed in block ${tx.blockHeight} (tx ${shortHex(tx.txId, 6)})`);
      }),
    );
}

// ── issuer ───────────────────────────────────────────────────────────────────────────
const issuer = program
  .command('issuer')
  .description('Issue credentials after an off-chain ID check');
issuer
  .command('init')
  .description('Create an issuer key on this machine and print its public key for the admin')
  .action(() =>
    withSession(async (s) => {
      const sk = randomBytes32();
      await s.join(address(), 'issuer', createAgePassPrivateState(sk));
      log.ok(`Issuer key created. Ask the admin to run:`);
      console.log(`  agepass admin add-issuer ${toHex(computeIssuerPk(sk))}`);
    }),
  );
issuer
  .command('issue')
  .description('Issue a credential (DEMO: never enter real personal data)')
  .requiredOption('--birth-date <YYYY-MM-DD>', 'birth date the issuer verified')
  .requiredOption('--expires <YYYY-MM-DD>', 'last day the credential is valid')
  .requiredOption('--holder-pk <hex>', "holder's public key")
  .option('--issuer-name <name>', 'name shown in the holder wallet', 'Demo Issuer')
  .option('-o, --out <file>', 'write the receipt for the holder to this file')
  .action(
    (o: {
      birthDate: string;
      expires: string;
      holderPk: string;
      issuerName: string;
      out?: string;
    }) =>
      withSession(async (s) => {
        const birthDate = parseIsoDate(o.birthDate);
        const expiresOn = parseIsoDate(o.expires);
        const holderPk = fromHex(o.holderPk, 32, 'holder key');
        const api = await s.join(address(), 'issuer');
        const state = await api.privateState();
        if (!state)
          throw new Error('AgePass: no issuer key here. Run "agepass issuer init" first.');
        const tx = await api.issueCredential({ birthDate, expiresOn, holderPk });
        const receipt = createReceipt({
          contractAddress: api.contractAddress,
          issuerName: o.issuerName,
          issuerPk: computeIssuerPk(state.secretKey),
          holderPk,
          birthDate,
          expiresOn,
          txId: tx.txId,
        });
        const json = JSON.stringify(receipt, null, 2);
        if (o.out) writeFileSync(o.out, json);
        log.ok(`Credential issued in block ${tx.blockHeight}.`);
        log.info('Give this receipt to the holder privately (it contains the birth date):');
        if (o.out) console.log(`  ${o.out}`);
        else console.log(json);
      }),
  );

// ── holder ───────────────────────────────────────────────────────────────────────────
const holder = program.command('holder').description('Hold a credential and answer age requests');
holder
  .command('init')
  .description('Create a holder secret on this device')
  .option('--name <name>', 'local profile name', 'me')
  .action((o: { name: string }) =>
    withSession(async (s) => {
      const sk = randomBytes32();
      await s.join(address(), holderId(o.name), createAgePassPrivateState(sk));
      log.ok(`Holder "${o.name}" created. Show this key to your issuer:`);
      console.log(`  ${toHex(computeHolderPk(sk))}`);
    }),
  );
holder
  .command('show-pk')
  .description('Print your holder public key')
  .option('--name <name>', 'local profile name', 'me')
  .action((o: { name: string }) =>
    withSession(async (s) => {
      const st = await (await s.join(address(), holderId(o.name))).privateState();
      if (!st) throw new Error(`AgePass: no holder "${o.name}" here. Run "agepass holder init".`);
      console.log(toHex(computeHolderPk(st.secretKey)));
    }),
  );
holder
  .command('import-credential <receipt>')
  .description('Import the receipt (file or JSON) after checking it against the registry')
  .option('--name <name>', 'local profile name', 'me')
  .action((receiptArg: string, o: { name: string }) =>
    withSession(async (s) => {
      const api = await s.join(address(), holderId(o.name));
      const st = await api.privateState();
      if (!st) throw new Error(`AgePass: no holder "${o.name}" here. Run "agepass holder init".`);
      const ledger = await readLedgerOrThrow(cfg(), api.contractAddress);
      const imported = verifyReceipt(parseReceipt(readJson(receiptArg)), st.secretKey, ledger);
      await api.setPrivateState(createAgePassPrivateState(st.secretKey, imported.credential));
      log.ok(`Credential from ${imported.issuerName} stored on this device.`);
      log.kv('expires', formatIsoDate(imported.credential.expiresOn));
      if (!imported.issuerStillApproved) log.warn('This issuer is no longer on the approved list.');
    }),
  );
holder
  .command('prove')
  .description("Answer a site's age request with a zero-knowledge proof")
  .requiredOption('--challenge <fileOrJson>', 'the request from the site')
  .option('--name <name>', 'local profile name', 'me')
  .action((o: { challenge: string; name: string }) =>
    withSession(async (s) => {
      const ch = parseChallenge(readJson(o.challenge));
      log.step(`${ch.siteName ?? ch.siteDomain} asks: are you ${ch.minAge} or older?`);
      log.info('They will learn: yes, plus a private nickname just for this site.');
      const api = await s.join(address(), holderId(o.name));
      const tx = await api.proveAge(ch);
      log.ok(`Proof accepted in block ${tx.blockHeight}.`);
    }),
  );

// ── site ─────────────────────────────────────────────────────────────────────────────
const site = program.command('site').description('Ask for and check age proofs (no wallet needed)');
site
  .command('challenge')
  .description('Create an age request for your site')
  .requiredOption('--domain <domain>', 'your site domain')
  .option('--min-age <n>', 'minimum age', '18')
  .option('--site-name <name>', 'display name')
  .option('-o, --out <file>', 'write the request JSON to this file')
  .action((o: { domain: string; minAge: string; siteName?: string; out?: string }) => {
    const ch = createChallenge({
      siteDomain: o.domain,
      minAge: Number(o.minAge),
      ...(o.siteName ? { siteName: o.siteName } : {}),
    });
    const json = JSON.stringify(ch, null, 2);
    if (o.out) {
      writeFileSync(o.out, json);
      log.ok(`Request written to ${o.out}`);
    } else console.log(json);
  });
site
  .command('check')
  .description('Check whether a request has been answered correctly')
  .requiredOption('--challenge <fileOrJson>', 'the request you issued')
  .option('--wait', 'poll until answered (up to 5 minutes)')
  .action(async (o: { challenge: string; wait?: boolean }) => {
    const ch = parseChallenge(readJson(o.challenge));
    const read = ledgerReader(publicData(cfg()), address());
    const r = o.wait
      ? await waitForVerification(read, ch)
      : evaluateLedger(ch, await readLedgerOrThrow(cfg(), address()));
    if (r.status === 'verified') log.ok(`Verified ${ch.minAge}+. Nym ${r.nym}`);
    else if (r.status === 'pending') log.warn('Not answered yet.');
    else {
      log.fail(`Rejected: ${r.message}`);
      process.exitCode = 1;
    }
  });

// ── ledger ───────────────────────────────────────────────────────────────────────────
program
  .command('ledger')
  .description('Print the public AgePass ledger (what everyone can see)')
  .action(async () => {
    const l = await readLedgerOrThrow(cfg(), address());
    log.kv('admin', toHex(l.admin));
    log.kv('issuers', [...l.issuers].map(toHex).join('\n                   ') || '(none)');
    log.kv('credentials', String(l.credentialCount));
    log.kv('verifications', String(l.verificationCount));
    for (const [id, v] of l.verifications) {
      console.log(
        `  ${shortHex(id, 6)} site ${shortHex(v.siteId, 6)} nym ${shortHex(v.nym, 6)} cutoff ${formatIsoDate(v.cutoffDate)} checked ${formatIsoDate(v.checkedOn)}`,
      );
    }
  });

program.parseAsync().catch((e: unknown) => {
  process.exitCode = reportError(e);
});
