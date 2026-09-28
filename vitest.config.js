import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Kept separate from vite.config.js so the app build config stays untouched.
// The suite targets pure logic (attendance maths, phone normalisation) plus
// static-markup rendering of a few components. Both run in the node
// environment: renderToStaticMarkup needs no DOM, so there is still no shim.
//
// The React plugin is here so .jsx test files get the JSX transform. Without it
// esbuild compiles JSX to bare `React.createElement` calls and every component
// test fails with "React is not defined".
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    // .jsx is included so component tests are not silently skipped.
    include: ['src/**/*.test.js', 'src/**/*.test.jsx'],
    reporters: 'default',
  },
});
