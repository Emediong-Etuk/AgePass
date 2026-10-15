// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Coloured console output for the CLI and the scripted demo (no dependency; honours NO_COLOR).

import { describeError } from '@agepass/sdk';

const useColor = process.stdout.isTTY !== false && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: paint(1),
  dim: paint(2),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  blue: paint(34),
  magenta: paint(35),
  cyan: paint(36),
};

export type Log = {
  title(s: string): void;
  step(s: string): void;
  info(s: string): void;
  ok(s: string): void;
  fail(s: string): void;
  warn(s: string): void;
  kv(key: string, value: string): void;
};

export const log: Log = {
  title: (s) => console.log(`\n${c.bold(c.magenta(`━━ ${s} `.padEnd(72, '━')))}`),
  step: (s) => console.log(`${c.cyan('›')} ${s}`),
  info: (s) => console.log(`  ${c.dim(s)}`),
  ok: (s) => console.log(`${c.green('✅')} ${s}`),
  fail: (s) => console.log(`${c.red('❌')} ${s}`),
  warn: (s) => console.log(`${c.yellow('⚠')}  ${s}`),
  kv: (k, v) => console.log(`  ${c.dim(`${k}:`.padEnd(16))} ${v}`),
};

/**
 * The node RPC client logs a line every time a wallet sync socket closes normally. It is
 * harmless and confusing in a demo, so drop exactly that message.
 */
export function quietNetworkNoise(): void {
  for (const k of ['log', 'warn', 'error'] as const) {
    const orig = console[k].bind(console);
    console[k] = (...args: unknown[]) => {
      if (args.some((a) => typeof a === 'string' && a.includes('Normal Closure'))) return;
      orig(...args);
    };
  }
}

/** Prints a friendly error (title, fix, detail) and returns the process exit code. */
export function reportError(e: unknown): number {
  const f = describeError(e);
  console.error(`${c.red('✖')} ${c.bold(f.title)}`);
  if (f.fix) console.error(`  ${f.fix}`);
  if (f.nothingShared) console.error(c.dim('  Nothing was sent to the network.'));
  console.error(c.dim(`  details: ${f.detail}`));
  return 1;
}
