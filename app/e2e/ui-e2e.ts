// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Browser end-to-end test of the web app against the LOCAL devnet (npm run e2e:ui).
//
// Lace cannot be automated, so the page gets a *test double* injected as window.midnight
// that implements the same DApp Connector 4.x calls the app uses. Balancing and submission
// are delegated to a real wallet-SDK wallet (the local genesis wallet) in this Node process,
// so every transaction is a real proof verified and included by the local node. Everything
// else (vault, Midnight.js browser providers, indexer reads) is the production code path.
// By default the double also proves for the page (DApp Connector `getProvingProvider`, backed
// by the local proof server) and advertises a dead proof-server URL, so every proof must go
// through the wallet. AGEPASS_UI_PROVING=server tests the local-proof-server path instead.
// Screenshots land in docs/img/.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Browser, type BrowserContext, type Page, chromium } from 'playwright';
import type {
  Binding,
  Proof,
  PreBinding,
  SignatureEnabled,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { createAgePassPrivateState, fromHex, randomBytes32, toHex } from '@agepass/sdk';
import { REPO_ROOT, loadConfig } from '../../cli/src/config.js';
import { ensureDevnet } from '../../cli/src/devnet.js';
import { log, quietNetworkNoise, reportError } from '../../cli/src/log.js';
import { openSession, type Session } from '../../cli/src/session.js';
import { walletProviders } from '../../cli/src/wallet.js';
import { httpClientProvingProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { ZK_ASSETS_PATH } from '../../cli/src/config.js';

quietNetworkNoise();
const IMG = path.join(REPO_ROOT, 'docs', 'img');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}/`;
const PASS = 'Night-Owl-Lantern-42';
const WALLET_PROVING = process.env.AGEPASS_UI_PROVING !== 'server';
let walletProofs = 0;
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (ok) log.info(`✓ ${what}`);
  else {
    failures.push(what);
    log.fail(`CHECK FAILED: ${what}`);
  }
};

async function startPreview(): Promise<ChildProcess> {
  const env = { ...process.env, VITE_NETWORK_ID: 'undeployed' };
  const appDir = path.join(REPO_ROOT, 'app');
  await new Promise<void>((resolve, reject) => {
    const b = spawn('npx', ['vite', 'build', '--outDir', 'dist-e2e'], {
      cwd: appDir,
      env,
      stdio: 'ignore',
    });
    b.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`vite build failed (${code})`)),
    );
  });
  const p = spawn(
    'npx',
    [
      'vite',
      'preview',
      '--outDir',
      'dist-e2e',
      '--port',
      String(PORT),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    {
      cwd: appDir,
      env,
      stdio: 'ignore',
    },
  );
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return p;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('vite preview did not start');
}

/** Injects the Lace test double into every page of the context. */
async function withLaceDouble(ctx: BrowserContext, session: Session): Promise<void> {
  const cfg = loadConfig('undeployed');
  const wp = walletProviders(session.wallet);
  await ctx.exposeBinding('__laceKeys', () => ({
    shieldedAddress: 'test-double',
    shieldedCoinPublicKey: wp.getCoinPublicKey(),
    shieldedEncryptionPublicKey: wp.getEncryptionPublicKey(),
  }));
  await ctx.exposeBinding('__laceBalance', async (_src, txHex: string) => {
    const tx = Transaction.deserialize<SignatureEnabled, Proof, PreBinding>(
      'signature',
      'proof',
      'pre-binding',
      fromHex(txHex),
    );
    return toHex((await wp.balanceTx(tx)).serialize());
  });
  await ctx.exposeBinding('__laceSubmit', async (_src, txHex: string) => {
    const tx = Transaction.deserialize<SignatureEnabled, Proof, Binding>(
      'signature',
      'proof',
      'binding',
      fromHex(txHex),
    );
    await wp.submitTx(tx);
  });
  const prover = httpClientProvingProvider(
    'http://127.0.0.1:6300',
    new NodeZkConfigProvider(ZK_ASSETS_PATH),
  );
  await ctx.exposeBinding(
    '__laceProve',
    async (_src, kind: 'check' | 'prove', preimageHex: string, key: string, bind?: string) => {
      if (kind === 'check') {
        const r = await prover.check(fromHex(preimageHex), key);
        return r.map((x) => (x === undefined ? null : x.toString()));
      }
      walletProofs++;
      const out = await prover.prove(
        fromHex(preimageHex),
        key,
        bind === undefined ? undefined : BigInt(bind),
      );
      return toHex(out);
    },
  );
  // Passed as source text: a serialized TS function would carry transpiler helpers.
  const e = JSON.stringify({
    indexer: cfg.indexer,
    indexerWS: cfg.indexerWS,
    node: cfg.node,
    prover: WALLET_PROVING ? 'http://127.0.0.1:6399' : 'http://127.0.0.1:6300',
    walletProving: WALLET_PROVING,
  });
  await ctx.addInitScript(`(() => {
    const e = ${e};
    const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
    const bytes = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
    const proving = {
      getProvingProvider: async () => ({
        check: async (pre, key) =>
          (await window.__laceProve('check', hex(pre), key)).map((x) => (x === null ? undefined : BigInt(x))),
        prove: async (pre, key, bind) =>
          bytes(await window.__laceProve('prove', hex(pre), key, bind === undefined ? undefined : bind.toString())),
      }),
    };
    window.midnight = {
      laceTestDouble: {
        name: 'Lace (test double)',
        rdns: 'network.agepass.test-double',
        icon: '',
        apiVersion: '4.0.1',
        connect: async (networkId) => ({
          getConnectionStatus: async () => ({ status: 'connected', networkId }),
          getConfiguration: async () => ({
            indexerUri: e.indexer,
            indexerWsUri: e.indexerWS,
            proverServerUri: e.prover,
            substrateNodeUri: e.node,
            networkId,
          }),
          getDustBalance: async () => ({ cap: 10n ** 18n, balance: 10n ** 18n }),
          getShieldedAddresses: () => window.__laceKeys(),
          balanceUnsealedTransaction: async (tx) => ({ tx: await window.__laceBalance(tx) }),
          submitTransaction: (tx) => window.__laceSubmit(tx),
          ...(e.walletProving ? proving : {}),
        }),
      },
    };
  })();`);
}

/**
 * Recording mode (AGEPASS_RECORD_DIR=<dir>): every browser profile is screen-recorded at
 * 1280×720 with slowed-down input and pauses on key screens, producing raw footage for the
 * demo video. Screenshots in docs/img are left untouched in this mode.
 */
const RECORD_DIR = process.env.AGEPASS_RECORD_DIR;
const recordings: { page: Page; name: string }[] = [];
const pace = (page: Page, ms: number) => (RECORD_DIR ? page.waitForTimeout(ms) : Promise.resolve());

async function newProfile(
  browser: Browser,
  session: Session,
  contract: string,
  name = 'profile',
): Promise<Page> {
  const size = RECORD_DIR ? { width: 1280, height: 720 } : { width: 1280, height: 860 };
  const ctx = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    ...(RECORD_DIR ? { recordVideo: { dir: RECORD_DIR, size } } : {}),
  });
  await withLaceDouble(ctx, session);
  await ctx.addInitScript(
    `localStorage.setItem('agepass.contract.undeployed', ${JSON.stringify(contract)});`,
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.warn(`page error: ${e.message}`));
  if (RECORD_DIR) recordings.push({ page, name });
  return page;
}

/** Full-page shot for the README, plus a 16:9 viewport crop for the slide deck. */
const shot = async (page: Page, name: string) => {
  if (RECORD_DIR) return;
  await page.screenshot({ path: path.join(IMG, `${name}.png`), fullPage: true });
  await page.screenshot({ path: path.join(IMG, 'deck', `${name}.png`) });
};

async function createVault(page: Page) {
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
  await page.getByLabel('Repeat passphrase').fill(PASS);
  await page.getByRole('button', { name: 'Create wallet' }).click();
}

/** Unlocks the vault if the app asks for it (it stays unlocked across in-app navigation). */
async function maybeUnlock(page: Page) {
  const field = page.getByLabel('Passphrase', { exact: true });
  if (await field.isVisible().catch(() => false)) {
    await field.fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
  }
}

async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect Lace' }).first().click();
  await page.getByText('connected to').first().waitFor({ timeout: 30_000 });
}

async function holderKey(page: Page): Promise<string> {
  await page.goto(`${BASE}#/wallet`);
  await createVault(page);
  await page.getByRole('button', { name: 'Generate my AgePass key' }).click();
  const key = await page.locator('.copy code').first().innerText();
  return key.trim();
}

async function main() {
  mkdirSync(path.join(IMG, 'deck'), { recursive: true });
  const config = loadConfig('undeployed');
  await ensureDevnet(config, log);
  const session = await openSession(config, log, {
    storagePassword: PASS,
    storeName: `agepass-ui-e2e-${Date.now()}`,
  });
  let preview: ChildProcess | undefined;
  let browser: Browser | undefined;
  const pages: Page[] = [];
  const track = (p: Page) => (pages.push(p), p);
  try {
    log.title('Setup: deploy (Node admin)');
    const adminSk = randomBytes32();
    const admin = await session.deploy(createAgePassPrivateState(adminSk), 'admin');
    const contract = admin.contractAddress;
    log.kv('contract', contract);
    preview = await startPreview();
    browser = await chromium.launch(RECORD_DIR ? { slowMo: 80 } : {});

    log.title('Landing and explorer');
    const visitor = track(
      await newProfile(browser, session, contract, 'clip-1-landing-and-explorer'),
    );
    await visitor.goto(BASE);
    await visitor.getByText('Not who you are.').waitFor();
    await shot(visitor, '01-landing');
    await pace(visitor, 3000);
    for (let i = 0; i < 6; i++) {
      await visitor.mouse.wheel(0, 250);
      await pace(visitor, 900);
    }
    await pace(visitor, 2000);

    log.title('Issuer desk (browser profile 1)');
    const issuer = track(await newProfile(browser, session, contract, 'clip-2-issuer-desk'));
    await issuer.goto(`${BASE}#/issuer`);
    await createVault(issuer);
    await issuer.getByRole('button', { name: 'Create issuer key' }).click();
    const issuerPk = (await issuer.locator('.copy code').first().innerText()).trim();
    check(/^[0-9a-f]{64}$/.test(issuerPk), 'issuer key shown');
    await admin.addIssuer(fromHex(issuerPk, 32));
    await issuer.reload();
    await issuer.getByLabel('Passphrase', { exact: true }).fill(PASS);
    await issuer.getByRole('button', { name: 'Unlock' }).click();
    await issuer.getByText('approved', { exact: true }).waitFor({ timeout: 30_000 });
    await connect(issuer);

    log.title('Holder wallet (browser profile 2)');
    const holder = track(await newProfile(browser, session, contract, 'clip-3-holder-and-store'));
    const holderPk = await holderKey(holder);
    check(/^[0-9a-f]{64}$/.test(holderPk), 'holder key shown');
    await shot(holder, '03-wallet-key');
    await pace(holder, 3000);

    log.step('Issuer issues a credential to the holder key (DEMO birth date)');
    await issuer.getByLabel('Holder public key (from their wallet)').fill(holderPk);
    await issuer.getByLabel('Verified birth date (DEMO)').fill('1998-04-12');
    await issuer
      .locator('code', { hasText: /^[0-9a-f]{64}$/ })
      .first()
      .waitFor();
    await shot(issuer, '02-issuer-desk');
    await pace(issuer, 3000);
    const t0 = Date.now();
    await issuer.getByRole('button', { name: 'Issue credential' }).click();
    await issuer.getByText('Receipt for the holder').waitFor({ timeout: 180_000 });
    log.info(`issued from the browser in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const receipt = await issuer
      .locator('.copy code', { hasText: 'agepass-credential' })
      .innerText();
    check(receipt.includes('"birthDate":"1998-04-12"'), 'receipt produced');
    await pace(issuer, 3000);

    log.step('Holder imports the receipt');
    await holder.getByLabel('Credential receipt JSON').fill(receipt);
    await holder.getByRole('button', { name: 'Import credential' }).click();
    await holder.getByText('Your credential').waitFor({ timeout: 60_000 });
    await shot(holder, '04-wallet-credential');
    await pace(holder, 3000);

    log.title('Corner Cellar: verify with AgePass');
    await holder.goto(`${BASE}#/store`);
    await shot(holder, '05-store-locked');
    await pace(holder, 3000);
    await holder.getByRole('button', { name: 'Verify with AgePass' }).click();
    await holder.waitForURL(/#\/wallet\?request=/);
    await maybeUnlock(holder);
    await holder.getByText('wants to know').waitFor();
    await connect(holder);
    await shot(holder, '06-approve-request');
    await pace(holder, 5000);
    const t1 = Date.now();
    await holder.getByRole('button', { name: 'Approve' }).click();
    await holder.getByText('Generating zero-knowledge proof').waitFor();
    await holder.getByRole('link', { name: /Return to/ }).waitFor({ timeout: 240_000 });
    log.info(`proved from the browser in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
    await shot(holder, '07-proof-confirmed');
    await pace(holder, 2500);
    await holder.getByRole('link', { name: /Return to/ }).click();
    await holder.getByText(/Welcome, nym 0x/).waitFor({ timeout: 90_000 });
    check(true, 'store unlocked after on-chain verification');
    await shot(holder, '08-store-unlocked');
    await pace(holder, 6000);

    log.title('Underage holder is stopped on-device');
    const minor = track(await newProfile(browser, session, contract, 'clip-4-underage-blocked'));
    const minorPk = await holderKey(minor);
    await issuer.goto(`${BASE}#/issuer`);
    await issuer.getByLabel('Holder public key (from their wallet)').fill(minorPk);
    await issuer.getByLabel('Verified birth date (DEMO)').fill(isoYearsAgo(16));
    await issuer.getByRole('button', { name: 'Issue credential' }).click();
    const minorReceiptLoc = issuer.locator('.copy code', { hasText: minorPk });
    await minorReceiptLoc.waitFor({ timeout: 180_000 });
    const minorReceipt = await minorReceiptLoc.innerText();
    await minor.getByLabel('Credential receipt JSON').fill(minorReceipt);
    await minor.getByRole('button', { name: 'Import credential' }).click();
    await minor.getByText('Your credential').waitFor({ timeout: 60_000 });
    const before = (await admin.readLedger())?.verificationCount;
    await minor.goto(`${BASE}#/store`);
    await minor.getByRole('button', { name: 'Verify with AgePass' }).click();
    await minor.waitForURL(/#\/wallet\?request=/);
    await maybeUnlock(minor);
    await minor.getByText('couldn’t confirm this request').waitFor();
    await shot(minor, '09-underage-blocked');
    await pace(minor, 5000);
    check(
      (await admin.readLedger())?.verificationCount === before,
      'underage attempt wrote nothing',
    );

    log.title('Explorer');
    await visitor.goto(`${BASE}#/explorer`);
    await visitor.getByText('Verification records').waitFor();
    await visitor.getByRole('cell').first().waitFor({ timeout: 30_000 });
    await shot(visitor, '10-explorer');
    await pace(visitor, 5000);

    // Mobile layout check for the approve screen.
    await holder.setViewportSize({ width: 390, height: 844 });
    await holder.goto(`${BASE}#/`);
    await shot(holder, '11-landing-mobile');
  } catch (e) {
    // Leave a screenshot of every open profile to make UI failures easy to diagnose.
    await Promise.all(
      pages.map((p, i) =>
        p
          .screenshot({ path: path.join(tmpdir(), `agepass-ui-fail-${i}.png`), fullPage: true })
          .catch(() => undefined),
      ),
    );
    throw e;
  } finally {
    // Closing each context finalizes its video; then give it a readable name.
    for (const r of recordings) {
      await r.page.context().close();
      await r.page
        .video()
        ?.saveAs(path.join(RECORD_DIR ?? '', `${r.name}.webm`))
        .catch(() => undefined);
      await r.page
        .video()
        ?.delete()
        .catch(() => undefined);
    }
    await browser?.close();
    preview?.kill();
    await session.close();
  }
  if (WALLET_PROVING) check(walletProofs > 0, `all proofs made by the wallet (${walletProofs})`);
  if (failures.length) throw new Error(`${failures.length} UI check(s) failed`);
  log.ok('UI e2e: all checks passed; screenshots in docs/img/');
}

function isoYearsAgo(n: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

main().then(
  () => process.exit(0),
  (e: unknown) => process.exit(reportError(e)),
);
