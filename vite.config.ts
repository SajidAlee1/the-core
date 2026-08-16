/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * `base` is NOT set here.
 *
 * GitHub Pages serves a project site from /<repo>/, so built asset URLs need
 * that prefix — but the function form of defineConfig with a conditional base
 * silently did not apply it: the config resolved, the build succeeded, and the
 * emitted HTML still pointed at /assets/. Every path 404'd on Pages.
 *
 * Passing --base on the build command instead is unambiguous, visible in
 * package.json, and cannot be quietly ignored. The dev server keeps the default
 * root base, which is what it needs.
 */
export default defineConfig({
  plugins: [react()],
  // Port comes from the harness via PORT so several dev servers can coexist.
  server: { port: Number(process.env.PORT) || 5174 },
  build: {
    // Three is large and stable; splitting it means a code change to our own
    // source does not invalidate the vendor chunk in the visitor's cache.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
  test: {
    // The sim is pure numerics with no DOM, so it needs no browser environment.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
