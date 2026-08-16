import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
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
});
