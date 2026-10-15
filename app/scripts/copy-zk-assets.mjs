// SPDX-License-Identifier: Apache-2.0
// Copies the compiler's prover/verifier keys and zkir into public/ so the browser can fetch
// them (FetchZkConfigProvider expects <base>/keys/* and <base>/zkir/*).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const managed = fileURLToPath(new URL('../../contract/src/managed/agepass/', import.meta.url));
const pub = fileURLToPath(new URL('../public/', import.meta.url));

if (!existsSync(`${managed}keys/proveAge.prover`)) {
  console.error('AgePass: contract keys missing. Run "npm run compact" at the repo root first.');
  process.exit(1);
}
for (const dir of ['keys', 'zkir']) {
  rmSync(`${pub}${dir}`, { recursive: true, force: true });
  mkdirSync(`${pub}${dir}`, { recursive: true });
  cpSync(`${managed}${dir}`, `${pub}${dir}`, { recursive: true });
}
console.log('AgePass: copied ZK keys and zkir into app/public');
