// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@agepass/contract': fileURLToPath(new URL('../contract/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
    reporters: ['default', ['junit', { outputFile: 'reports/junit.xml' }]],
    coverage: {
      provider: 'v8',
      include: ['src/{bytes,challenge,dates,errors,keys,network,password,receipt,verifier}.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
