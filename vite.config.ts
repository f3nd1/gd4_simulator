import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // allowedHosts: true lets the Codespaces preview domain (*.preview.app.github.dev)
    // reach the dev server without a host-check 403.
    allowedHosts: true,
    hmr: {
      // In GitHub Codespaces the browser always connects through the HTTPS proxy
      // on port 443, even though Vite is listening on 5173 inside the container.
      // Without this, the HMR WebSocket tries to upgrade on port 5173 which the
      // Codespaces proxy never exposes directly, so hot-module replacement silently
      // fails.  clientPort: 443 tells the browser-side HMR client to use the
      // proxied HTTPS port instead.
      //
      // Side-effect in LOCAL dev: HMR socket tries localhost:443 (fails) so hot
      // reload falls back to full-page refreshes.  This does NOT prevent the app
      // from loading — only live-edit auto-refresh is affected.  Remove this block
      // temporarily if you need HMR while developing purely locally.
      clientPort: 443,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
})
