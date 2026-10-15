// SPDX-License-Identifier: Apache-2.0
// Some Midnight.js dependencies expect Node's Buffer and process; provide them before any
// of those modules load (this file is imported first by main.tsx).
import { Buffer } from 'buffer';

const g = globalThis as unknown as {
  Buffer?: typeof Buffer;
  process?: { env: Record<string, string> };
};
g.Buffer ??= Buffer;
g.process ??= { env: { NODE_ENV: import.meta.env.MODE } };
