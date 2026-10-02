import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/gym-be-smart/' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
    // Reach the dev server from a phone on the same Wi-Fi (http://<pc-ip>:3000).
    // That is plain HTTP, so the phone still blocks the QR camera: browsers only
    // hand out cameras over HTTPS. Use Scan a photo on the QR page, or serve the
    // build from HTTPS, when testing on a handset.
    host: true,
    allowedHosts: true,
  },
});
