import { defineConfig } from 'tsup';

// Mirrors evrree-ui/tsup.config.ts, minus the React/Tailwind bits, plus
// the 3 package entry points this SDK needs (., ./testing, ./nestjs).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'testing/index': 'src/testing/index.ts',
    'nestjs/index': 'src/nestjs/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'node20',
  platform: 'node',
  // firebase-admin and @nestjs/common are optional peer deps — never bundle
  // them, and never let their absence break a build/import of the core entry.
  external: ['firebase-admin', '@nestjs/common', '@nestjs/core', 'reflect-metadata'],
});
