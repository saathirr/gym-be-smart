import { defineConfig } from 'vitest/config';
import path from 'path';

// Kept separate from vite.config.js so the app build config stays untouched.
// The suite targets pure logic (attendance maths, phone normalisation), so it
// runs in the node environment and needs no DOM shim.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    reporters: 'default',
  },
});
