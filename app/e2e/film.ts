// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Produces the silent, captioned product demo video (≤ 2 min) by driving the real web app
// against a real Midnight network (default: Preview) and editing the recording with ffmpeg.
//
//   npm run film            → media/agepass-demo.mp4
//
// Every transaction in the video is real. Lace cannot be automated, so the page gets the
// same DApp-Connector stand-in as e2e:ui ("Demo wallet (automated)"), backed by the .env fee
// wallet. Waiting time (proofs, block inclusion) is cut or sped up and labelled as such.
// Needs: compiled contract, a running proof server on :6300, ffmpeg, and for Preview a
// funded AGEPASS_WALLET_SEED in .env.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
  chromium,
} from 'playwright';
import type {
  Binding,
  PreBinding,
  Proof,
  SignatureEnabled,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { createAgePassPrivateState, fromHex, randomBytes32, toHex } from '@agepass/sdk';
import { REPO_ROOT, loadConfig } from '../../cli/src/config.js';
import { ensureDevnet } from '../../cli/src/devnet.js';
import { log, quietNetworkNoise, reportError } from '../../cli/src/log.js';
import { type Session, assertProofServer, openSession } from '../../cli/src/session.js';
import { walletProviders } from '../../cli/src/wallet.js';

quietNetworkNoise();

const NETWORK = process.env.AGEPASS_FILM_NETWORK ?? 'preview';
const OUT = path.join(REPO_ROOT, 'media');
const RAW = path.join(OUT, 'film-raw');
const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}/`;
const PASS = 'Night-Owl-Lantern-42';
const SIZE = { width: 1280, height: 720 };

// ── recording helpers ──────────────────────────────────────────────────────────────────

type Mark = { name: string; t: number };
type Frame = { ts: number; file: string };

/**
 * One browser page recorded through the CDP screencast. Every frame carries the wall-clock
 * time it was painted, and marks use the same clock, so the edit cuts exactly where the
 * script says (Playwright's recordVideo drifts against wall-clock marks).
 */
class Take {
  readonly marks: Mark[] = [];
  readonly frames: Frame[] = [];
  readonly dir: string;
  private cdp?: CDPSession;
  private pending?: { ts: number; data: string };
  /** Minimum gap between kept frames; widened during long waits that get sped up. */
  private minGap = 1 / 30;
  constructor(
    readonly page: Page,
    readonly name: string,
  ) {
    this.dir = path.join(RAW, name);
    mkdirSync(this.dir, { recursive: true });
  }
  async start() {
    const cdp = await this.page.context().newCDPSession(this.page);
    this.cdp = cdp;
    cdp.on('Page.screencastFrame', (f) => {
      const ts = f.metadata.timestamp ?? Date.now() / 1000;
      const last = this.frames.at(-1)?.ts ?? 0;
      if (ts - last >= this.minGap) {
        this.pending = undefined;
        this.save(ts, f.data);
      } else this.pending = { ts, data: f.data };
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 85,
      maxWidth: SIZE.width,
      maxHeight: SIZE.height,
      everyNthFrame: 1,
    });
  }
  async stop() {
    await this.cdp?.send('Page.stopScreencast').catch(() => {});
    this.flush();
  }
  /** Keep fewer frames while waiting on proofs / blocks (that footage is sped up). */
  sparse(on: boolean) {
    this.flush();
    this.minGap = on ? 0.25 : 1 / 30;
  }
  /**
   * Marks "the page as it is now". Paint can lag the DOM (the page may be busy, e.g. encrypting
   * private state), so force a repaint and stamp the mark with the first frame painted after it.
   */
  async mark(name: string) {
    const t0 = Date.now() / 1000;
    await this.page
      .evaluate(() => {
        let el = document.getElementById('film-tick');
        if (!el) {
          el = document.createElement('div');
          el.id = 'film-tick';
          el.setAttribute(
            'style',
            'position:fixed;right:0;bottom:0;width:2px;height:2px;pointer-events:none;z-index:2147483647',
          );
          document.body.appendChild(el);
        }
        el.style.opacity = el.style.opacity === '0.01' ? '0.02' : '0.01';
        el.style.background = '#000';
      })
      .catch(() => {});
    const painted = () => Math.max(this.frames.at(-1)?.ts ?? 0, this.pending?.ts ?? 0) >= t0;
    for (let i = 0; i < 500 && !painted(); i++) await new Promise((r) => setTimeout(r, 20));
    this.flush();
    const first = this.frames.find((f) => f.ts >= t0);
    this.marks.push({ name, t: first?.ts ?? t0 });
  }
  at(name: string): number {
    const m = this.marks.find((x) => x.name === name);
    if (!m) throw new Error(`film: missing mark ${name} in ${this.name}`);
    return m.t;
  }
  private flush() {
    if (this.pending) this.save(this.pending.ts, this.pending.data);
    this.pending = undefined;
  }
  private save(ts: number, data: string) {
    const file = path.join(this.dir, `${String(this.frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    this.frames.push({ ts, file });
  }
}

const hold = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Optional on-screen caption drawn over the app (AGEPASS_FILM_CAPTIONS=1); off by default. */
const CAPTIONS = process.env.AGEPASS_FILM_CAPTIONS === '1';
async function caption(page: Page, title: string, sub = '') {
  if (!CAPTIONS) return;
  await page.evaluate(
    ([t, s]) => {
      let el = document.getElementById('film-cap');
      if (!el) {
        el = document.createElement('div');
        el.id = 'film-cap';
        el.setAttribute(
          'style',
          [
            'position:fixed',
            'left:50%',
            'bottom:22px',
            'transform:translateX(-50%)',
            'z-index:99999',
            'max-width:1040px',
            'width:max-content',
            'padding:14px 24px',
            'border-radius:16px',
            'background:rgba(7,14,34,0.94)',
            'border:1.5px solid #34e0a1',
            'box-shadow:0 12px 40px rgba(0,0,0,0.55)',
            'font-family:Inter,system-ui,sans-serif',
            'color:#eef3ff',
            'text-align:center',
            'transition:opacity .25s',
          ].join(';'),
        );
        document.body.appendChild(el);
      }
      el.innerHTML =
        `<div style="font-size:23px;font-weight:700;letter-spacing:-.01em">${t}</div>` +
        (s ? `<div style="font-size:15px;color:#b8c4e3;margin-top:4px">${s}</div>` : '');
    },
    [title, sub],
  );
}

const nav = (page: Page, hash: string) =>
  page.evaluate((h) => {
    window.location.hash = h;
  }, hash);

async function typeSlow(page: Page, label: string, text: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.click();
  await field.pressSequentially(text, { delay: 35 });
}

// ── app + wallet plumbing (same approach as e2e:ui) ───────────────────────────────────

async function startApp(): Promise<ChildProcess> {
  const env = { ...process.env, VITE_NETWORK_ID: NETWORK };
  const appDir = path.join(REPO_ROOT, 'app');
  execFileSync('npx', ['vite', 'build', '--outDir', 'dist-e2e'], {
    cwd: appDir,
    env,
    stdio: 'ignore',
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
    { cwd: appDir, env, stdio: 'ignore' },
  );
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return p;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('film: vite preview did not start');
}

async function withDemoWallet(ctx: BrowserContext, session: Session) {
  const cfg = loadConfig(NETWORK);
  const wp = walletProviders(session.wallet);
  await ctx.exposeBinding('__laceKeys', () => ({
    shieldedAddress: 'demo',
    shieldedCoinPublicKey: wp.getCoinPublicKey(),
    shieldedEncryptionPublicKey: wp.getEncryptionPublicKey(),
  }));
  await ctx.exposeBinding('__laceBalance', async (_s, hex: string) => {
    const tx = Transaction.deserialize<SignatureEnabled, Proof, PreBinding>(
      'signature',
      'proof',
      'pre-binding',
      fromHex(hex),
    );
    return toHex((await wp.balanceTx(tx)).serialize());
  });
  await ctx.exposeBinding('__laceSubmit', async (_s, hex: string) => {
    const tx = Transaction.deserialize<SignatureEnabled, Proof, Binding>(
      'signature',
      'proof',
      'binding',
      fromHex(hex),
    );
    await wp.submitTx(tx);
  });
  const e = JSON.stringify({ indexer: cfg.indexer, indexerWS: cfg.indexerWS, node: cfg.node });
  await ctx.addInitScript(`(() => {
    const e = ${e};
    window.midnight = { demo: {
      name: 'Demo wallet (automated)', rdns: 'network.agepass.demo', icon: '', apiVersion: '4.0.1',
      connect: async (networkId) => ({
        getConnectionStatus: async () => ({ status: 'connected', networkId }),
        getConfiguration: async () => ({ indexerUri: e.indexer, indexerWsUri: e.indexerWS,
          proverServerUri: 'http://127.0.0.1:6300', substrateNodeUri: e.node, networkId }),
        getDustBalance: async () => ({ cap: 10n ** 18n, balance: 10n ** 18n }),
        getShieldedAddresses: () => window.__laceKeys(),
        balanceUnsealedTransaction: async (tx) => ({ tx: await window.__laceBalance(tx) }),
        submitTransaction: (tx) => window.__laceSubmit(tx),
      }),
    } };
  })();`);
}

async function newTake(browser: Browser, session: Session, contract: string, name: string) {
  const ctx = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
  });
  await withDemoWallet(ctx, session);
  await ctx.addInitScript(
    `localStorage.setItem('agepass.contract.${NETWORK}', ${JSON.stringify(contract)});`,
  );
  const page = await ctx.newPage();
  page.on('pageerror', (err) => log.warn(`page error: ${err.message}`));
  const take = new Take(page, name);
  await take.start();
  return take;
}

async function unlockIfAsked(page: Page) {
  const f = page.getByLabel('Passphrase', { exact: true });
  if (await f.isVisible().catch(() => false)) {
    await f.fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
  }
}

async function createVault(page: Page) {
  await typeSlow(page, 'Passphrase', PASS);
  await page.getByLabel('Repeat passphrase').fill(PASS);
  await page.getByRole('button', { name: 'Create wallet' }).click();
}

async function connect(page: Page) {
  const btn = page.getByRole('button', { name: 'Connect Lace' }).first();
  if (await btn.isVisible().catch(() => false)) await btn.click();
  await page.getByText('connected to').first().waitFor({ timeout: 30_000 });
}

const yearsAgoIso = (n: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
};

// ── title cards ────────────────────────────────────────────────────────────────────────

const LOGO = `<svg width="84" height="84" viewBox="0 0 32 32"><path d="M16 2 4 6.5v8.2C4 22.3 9.1 28.4 16 30c6.9-1.6 12-7.7 12-15.3V6.5Z" fill="#12204a" stroke="#34e0a1" stroke-width="1.2"/><path d="m10.5 16.2 3.8 3.8 7.4-7.6" fill="none" stroke="#34e0a1" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CARDS: Record<string, string> = {
  title: `${LOGO}<h1>AgePass</h1><h2>Prove you’re 18+. <span>Not who you are.</span></h2><p class="foot">Zero-knowledge age checks · Built on Midnight</p>`,
  problem: `<h3>The problem</h3><h2>Age checks today mean uploading your passport<br/>to every website.</h2><p>Sites only need a <b>yes or no</b> — but they end up holding full identities<br/>that get breached, sold, or kept forever.</p>`,
  solution: `<h3>The AgePass way</h3><ol><li><b>Verify once</b> with a trusted issuer.</li><li><b>Prove anywhere</b> with a zero-knowledge proof from your device.</li><li><b>Sites learn “yes”</b> — plus a nickname that only works on their site.</li></ol><p class="foot">Recorded live on Midnight Preview · demo data only</p>`,
  end: `${LOGO}<h1>AgePass</h1><h2>Prove you’re 18+. <span>Not who you are.</span></h2><p>Compact contract · ZK membership proofs · per-site pseudonyms<br/>100 automated tests · live on Midnight Preview</p><p class="url">github.com/Emediong-Etuk/AgePass</p><p class="foot">Built on Midnight · Apache-2.0 · wallet connection automated for recording; every transaction is real</p>`,
};

async function renderCards(browser: Browser) {
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  for (const [name, body] of Object.entries(CARDS)) {
    await page.setContent(`<!doctype html><html><head><style>
      html,body{margin:0;height:100%;}
      body{background:radial-gradient(900px 500px at 50% -120px,#16295c 0%,#070e22 70%);color:#eef3ff;
        font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;
        justify-content:center;text-align:center;gap:6px;padding:0 80px;box-sizing:border-box}
      h1{font-size:72px;margin:8px 0 0;font-weight:800;letter-spacing:-.03em}
      h2{font-size:38px;margin:8px 0;font-weight:700;letter-spacing:-.02em;line-height:1.25}
      h2 span{color:#34e0a1} h3{color:#34e0a1;font-size:20px;text-transform:uppercase;letter-spacing:.12em;margin:0}
      p{font-size:22px;color:#b8c4e3;line-height:1.5;margin:10px 0} b{color:#eef3ff}
      ol{font-size:30px;text-align:left;line-height:1.7;margin:18px 0} ol b{color:#34e0a1}
      .url{color:#34e0a1;font-weight:700;font-size:26px}.foot{font-size:16px;color:#8794b8;margin-top:22px}
      </style></head><body>${body}</body></html>`);
    await page.screenshot({ path: path.join(RAW, `card-${name}.png`) });
  }
  await page.close();
}

// ── the story ──────────────────────────────────────────────────────────────────────────

async function main() {
  rmSync(RAW, { recursive: true, force: true });
  mkdirSync(RAW, { recursive: true });
  const config = loadConfig(NETWORK);
  if (config.networkId === 'undeployed') await ensureDevnet(config, log);
  else await assertProofServer(config);

  log.title(`Recording AgePass demo on ${config.networkId}`);
  const session = await openSession(config, log, {
    storagePassword: PASS,
    storeName: `agepass-film-${Date.now()}`,
  });
  let app: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    const admin = await session.deploy(createAgePassPrivateState(randomBytes32()), 'admin');
    log.kv('contract', admin.contractAddress);
    app = await startApp();
    browser = await chromium.launch({ slowMo: 40 });
    await renderCards(browser);

    // Take A: one person's whole journey (issuer and holder share one vault for filming).
    const A = await newTake(browser, session, admin.contractAddress, 'main');
    const p = A.page;
    await p.goto(BASE);
    await p.getByText('Not who you are.').waitFor();
    await caption(p, 'AgePass', 'Prove you’re 18+ without showing your ID');
    await A.mark('landing_start');
    await hold(p, 2500);
    for (let i = 0; i < 5; i++) {
      await p.mouse.wheel(0, 230);
      await hold(p, 650);
    }
    await caption(p, 'Sites learn “yes”. They never learn who you are.');
    await hold(p, 2500);
    await A.mark('landing_end');

    await nav(p, '/wallet');
    await caption(p, '1 · Your device creates a secret key', 'It never leaves this browser');
    await A.mark('wallet_start');
    await createVault(p);
    await p.getByRole('button', { name: 'Generate my AgePass key' }).click();
    const holderPk = (await p.locator('.copy code').first().innerText()).trim();
    await caption(
      p,
      '1 · Your device creates a secret key',
      'You share only its public key with an issuer',
    );
    await hold(p, 2800);
    await A.mark('wallet_end');

    await nav(p, '/issuer');
    await caption(
      p,
      '2 · A trusted issuer checks your ID once',
      'Demo issuer desk — in production a bank, telco or KYC provider',
    );
    await A.mark('issuer_start');
    await p.getByRole('button', { name: 'Create issuer key' }).click();
    const issuerPk = (await p.locator('.copy code').first().innerText()).trim();
    await hold(p, 1500);
    await A.mark('issuer_key');
    await admin.addIssuer(fromHex(issuerPk, 32)); // the admin approves this issuer on-chain
    await nav(p, '/');
    await nav(p, '/issuer');
    await p.getByText('approved', { exact: true }).waitFor({ timeout: 60_000 });
    await A.mark('approved');
    await connect(p);
    await typeSlow(p, 'Holder public key (from their wallet)', holderPk.slice(0, 24));
    await p.getByLabel('Holder public key (from their wallet)', { exact: true }).fill(holderPk);
    await p.getByLabel('Verified birth date (DEMO)').fill('1998-04-12');
    await caption(
      p,
      'Only a hidden commitment goes on-chain',
      'Never the birth date, never the holder key',
    );
    await hold(p, 3500);
    await p.getByRole('button', { name: 'Issue credential' }).click();
    await A.mark('issue_wait_start');
    A.sparse(true);
    await p.getByText('Receipt for the holder').waitFor({ timeout: 300_000 });
    A.sparse(false);
    await A.mark('issue_wait_end');
    await caption(
      p,
      'Credential issued on Midnight',
      'The receipt goes back to the holder privately',
    );
    await hold(p, 3000);
    await A.mark('issuer_end');
    const receipt = await p.locator('.copy code', { hasText: 'agepass-credential' }).innerText();

    await nav(p, '/wallet');
    await caption(
      p,
      '3 · The credential lives only on your device',
      'Checked against the on-chain registry before it is saved',
    );
    await A.mark('import_start');
    await p.getByLabel('Credential receipt JSON').fill(receipt);
    await p.getByRole('button', { name: 'Import credential' }).click();
    await p.getByText('Your credential').waitFor({ timeout: 90_000 });
    await hold(p, 3000);
    await A.mark('import_end');

    await nav(p, '/store');
    await caption(
      p,
      '4 · A shop asks: “Are you 18 or older?”',
      'Corner Cellar — a fictional age-gated store',
    );
    await A.mark('store_start');
    await hold(p, 3000);
    await A.mark('verify_click');
    await p.getByRole('button', { name: 'Verify with AgePass' }).click();
    await p.waitForURL(/#\/wallet\?request=/);
    await unlockIfAsked(p);
    await p.getByText('wants to know').waitFor();
    await A.mark('request_shown');
    await caption(p, 'You see exactly what the site will learn', '…and what it will never learn');
    await hold(p, 5000);
    await p.getByRole('button', { name: 'Approve' }).click();
    await caption(
      p,
      'A zero-knowledge proof is generated on your device',
      'Real proof and transaction on Midnight Preview (sped up)',
    );
    await A.mark('prove_start');
    A.sparse(true);
    await p.getByRole('link', { name: /Return to/ }).waitFor({ timeout: 300_000 });
    A.sparse(false);
    await A.mark('prove_end');
    await hold(p, 1800);
    await p.getByRole('link', { name: /Return to/ }).click();
    await A.mark('return_click');
    await p.getByText(/Welcome, nym 0x/).waitFor({ timeout: 180_000 });
    await caption(
      p,
      'Unlocked. The store learned only “yes” + a nickname',
      'This panel is the exact public record — no name, no birth date',
    );
    await A.mark('unlocked');
    await hold(p, 6500);
    await A.mark('store_end');

    // Take B: a 16-year-old (prepared off-camera, then filmed at the store).
    const B = await newTake(browser, session, admin.contractAddress, 'minor');
    const q = B.page;
    await q.goto(`${BASE}#/wallet`);
    await createVault(q);
    await q.getByRole('button', { name: 'Generate my AgePass key' }).click();
    const minorPk = (await q.locator('.copy code').first().innerText()).trim();
    A.sparse(true);
    B.sparse(true);
    await nav(p, '/issuer'); // A issues to the minor (cut from the film)
    await p.getByLabel('Holder public key (from their wallet)', { exact: true }).fill(minorPk);
    await p.getByLabel('Verified birth date (DEMO)').fill(yearsAgoIso(16));
    await p.getByRole('button', { name: 'Issue credential' }).click();
    const minorReceipt = p.locator('.copy code', { hasText: minorPk });
    await minorReceipt.waitFor({ timeout: 300_000 });
    await q.getByLabel('Credential receipt JSON').fill(await minorReceipt.innerText());
    await q.getByRole('button', { name: 'Import credential' }).click();
    await q.getByText('Your credential').waitFor({ timeout: 90_000 });
    A.sparse(false);
    B.sparse(false);
    await nav(q, '/store');
    await caption(q, '5 · A 16-year-old tries the same store');
    await B.mark('minor_start');
    await hold(q, 2200);
    await B.mark('minor_click');
    await q.getByRole('button', { name: 'Verify with AgePass' }).click();
    await q.waitForURL(/#\/wallet\?request=/);
    await unlockIfAsked(q);
    await q.getByText('couldn’t confirm this request').waitFor();
    await B.mark('minor_blocked');
    await caption(
      q,
      'Blocked on the device. Nothing is shared, nothing is sent.',
      'The check fails before a proof even exists',
    );
    await hold(q, 5500);
    await B.mark('minor_end');

    await nav(p, '/explorer');
    await caption(
      p,
      '6 · Everything that is public on-chain',
      'Issuers, counts and verification records — no names, no birth dates',
    );
    await p.getByRole('cell').first().waitFor({ timeout: 90_000 });
    await A.mark('explorer_start');
    await hold(p, 6000);
    await A.mark('explorer_end');

    // Finalize recordings.
    for (const take of [A, B]) await take.stop();
    writeFileSync(
      path.join(RAW, 'marks.json'),
      JSON.stringify(
        {
          contract: admin.contractAddress,
          main: { marks: A.marks, frames: A.frames },
          minor: { marks: B.marks, frames: B.frames },
        },
        null,
        2,
      ),
    );
    compose(A, B);
  } finally {
    await browser?.close();
    app?.kill();
    await session.close();
  }
}

// ── edit ───────────────────────────────────────────────────────────────────────────────

type Seg =
  | { card: string; secs: number }
  | { take: Take; from: number; to: number; speed?: number };

/** ffmpeg concat-demuxer list showing `take` from wall-clock `a` to `b`, sped up `k`×. */
function frameList(take: Take, a: number, b: number, k: number): string {
  const fr = take.frames;
  // Start on the first frame painted at or after `a`: the DOM can be ahead of the last
  // paint at the moment a mark is taken (e.g. right after a navigation).
  let i = fr.findIndex((f) => f.ts >= a && f.ts < b);
  if (i < 0) {
    i = 0;
    fr.forEach((f, j) => {
      if (f.ts <= a) i = j;
    });
  }
  const lines: string[] = [];
  let last = '';
  for (let j = i; j < fr.length && (fr[j] as Frame).ts < b; j++) {
    const f = fr[j] as Frame;
    const next = fr[j + 1]?.ts ?? b;
    const dur = (Math.min(next, b) - (j === i ? a : f.ts)) / k;
    if (dur <= 0) continue;
    lines.push(`file '${f.file}'`, `duration ${dur.toFixed(4)}`);
    last = f.file;
  }
  if (!last) throw new Error(`film: no frames in ${take.name} between ${a} and ${b}`);
  lines.push(`file '${last}'`); // the concat demuxer ignores the last entry's duration
  return lines.join('\n');
}

function compose(A: Take, B: Take) {
  const segs: Seg[] = [
    { card: 'title', secs: 4 },
    { card: 'problem', secs: 6 },
    { card: 'solution', secs: 7 },
    { take: A, from: A.at('landing_start'), to: A.at('landing_end') },
    { take: A, from: A.at('wallet_start'), to: A.at('wallet_end') },
    { take: A, from: A.at('issuer_start'), to: A.at('issuer_key') },
    { take: A, from: A.at('approved'), to: A.at('issue_wait_start') },
    { take: A, from: A.at('issue_wait_start'), to: A.at('issue_wait_end'), speed: 10 },
    { take: A, from: A.at('issue_wait_end'), to: A.at('issuer_end') },
    { take: A, from: A.at('import_start'), to: A.at('import_end') },
    { take: A, from: A.at('store_start'), to: A.at('verify_click') },
    { take: A, from: A.at('request_shown'), to: A.at('prove_start') },
    { take: A, from: A.at('prove_start'), to: A.at('prove_end'), speed: 8 },
    { take: A, from: A.at('prove_end'), to: A.at('return_click') },
    { take: A, from: A.at('unlocked'), to: A.at('store_end') },
    { take: B, from: B.at('minor_start'), to: B.at('minor_click') },
    { take: B, from: B.at('minor_blocked'), to: B.at('minor_end') },
    { take: A, from: A.at('explorer_start'), to: A.at('explorer_end') },
    { card: 'end', secs: 7 },
  ];
  const common = ['-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', '30'];
  const fit = `scale=${SIZE.width}:${SIZE.height}:force_original_aspect_ratio=decrease,pad=${SIZE.width}:${SIZE.height}:(ow-iw)/2:(oh-ih)/2:color=0x070e22,setsar=1`;
  const parts: string[] = [];
  segs.forEach((s, i) => {
    const out = path.join(RAW, `seg-${String(i).padStart(2, '0')}.mp4`);
    if ('card' in s) {
      const fade = `fade=t=in:st=0:d=0.4,fade=t=out:st=${s.secs - 0.4}:d=0.4`;
      run([
        '-loop',
        '1',
        '-t',
        String(s.secs),
        '-i',
        path.join(RAW, `card-${s.card}.png`),
        '-vf',
        `${fit},fps=30,${fade},format=yuv420p`,
        ...common,
        out,
      ]);
    } else {
      const list = path.join(RAW, `seg-${String(i).padStart(2, '0')}.txt`);
      writeFileSync(list, frameList(s.take, s.from, s.to, s.speed ?? 1));
      run([
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-vf',
        `${fit},fps=30,format=yuv420p`,
        ...common,
        out,
      ]);
    }
    parts.push(out);
  });
  const list = path.join(RAW, 'list.txt');
  writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
  const final = path.join(OUT, 'agepass-demo.mp4');
  run([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-an',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    final,
  ]);
  const dur = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    final,
  ])
    .toString()
    .trim();
  log.ok(`Video: ${final} (${Number(dur).toFixed(1)} s, no audio)`);
}

function run(args: string[]) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

/** `AGEPASS_FILM_RECOMPOSE=1`: re-edit the last recording from media/film-raw, no filming. */
function recompose() {
  const d = JSON.parse(readFileSync(path.join(RAW, 'marks.json'), 'utf8')) as Record<
    string,
    { marks: Mark[]; frames: Frame[] }
  >;
  const take = (name: string) => {
    const t = Object.create(Take.prototype) as Take;
    Object.assign(t, { name, ...d[name] });
    return t;
  };
  compose(take('main'), take('minor'));
  return Promise.resolve();
}

(process.env.AGEPASS_FILM_RECOMPOSE === '1' ? recompose() : main()).then(
  () => process.exit(0),
  (e: unknown) => process.exit(reportError(e)),
);
