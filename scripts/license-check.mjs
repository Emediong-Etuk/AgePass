#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fails CI if any source file lacks an SPDX header, because the hackathon requires
// Apache-2.0 headers in every .compact, .ts, .tsx and script file.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SOURCE = /\.(compact|ts|tsx|js|mjs|cjs|sh)$/;
const HEADER = 'SPDX-License-Identifier: Apache-2.0';
// Generated or third-party files that we do not author.
const SKIP = [
  /^scanpay\//,
  /^contract\/src\/managed\//,
  /(^|\/)dist\//,
  /\.d\.ts$/,
  /^app\/public\//,
];

// Use git so ignored files (node_modules, build output) are never checked.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((f) => SOURCE.test(f) && !SKIP.some((re) => re.test(f)));

const missing = files.filter((f) => {
  try {
    // The header must be near the top, not buried in the file.
    return !readFileSync(f, 'utf8').split('\n').slice(0, 5).join('\n').includes(HEADER);
  } catch {
    return false; // deleted in the working tree but still listed by git
  }
});

if (missing.length > 0) {
  console.error(`Missing "${HEADER}" header in ${missing.length} file(s):`);
  for (const f of missing) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`license:check OK: ${files.length} source files carry the SPDX header.`);
