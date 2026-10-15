// SPDX-License-Identifier: Apache-2.0
// Build setup mirrors the official Midnight example UIs: the on-chain runtime ships as WASM
// with top-level await (native at the ES2022 target), and some Midnight.js dependencies expect Node's Buffer/process.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => ({
  // Relative base so the static build works on GitHub Pages sub-paths, Netlify and Vercel.
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    global: 'globalThis',
  },
  plugins: [
    nodePolyfills({ include: ['buffer', 'process'], globals: { Buffer: true, process: true } }),
    wasm(),
    react(),
    viteCommonjs(),
  ],
  resolve: {
    alias: {
      // Use workspace sources directly so the app never runs against a stale build.
      '@agepass/contract': src('../contract/src/index.ts'),
      '@agepass/sdk': src('../sdk/src/index.ts'),
      'isomorphic-ws': src('./src/shims/isomorphic-ws.ts'),
    },
  },
  optimizeDeps: {
    esbuildOptions: { define: { global: 'globalThis' }, target: 'es2022' },
    exclude: ['@midnight-ntwrk/onchain-runtime-v3'],
  },
  build: {
    target: 'es2022',
    commonjsOptions: { transformMixedEsModules: true },
    chunkSizeWarningLimit: 8000,
  },
  server: { fs: { allow: ['..'] } },
}));
