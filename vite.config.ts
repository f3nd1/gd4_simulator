import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

function gitInfo() {
  try {
    const hash    = execSync('git rev-parse --short HEAD').toString().trim()
    const branch  = execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
    const message = execSync('git log -1 --pretty=%s').toString().trim()
    const isoTime = execSync('git log -1 --pretty=%cI').toString().trim()
    const ahead   = execSync('git rev-list @{u}..HEAD --count 2>/dev/null || echo 0').toString().trim()
    return { hash, branch, message, isoTime, ahead: parseInt(ahead, 10) }
  } catch {
    return { hash: 'unknown', branch: 'unknown', message: '', isoTime: '', ahead: 0 }
  }
}

// The full commit history, embedded at build time, so the Change Log can show
// every change straight from git — subject, full description body AND the list
// of files each commit touched — without depending on how many times the app
// happened to be deployed/loaded. Records are separated by \x1e and fields by
// \x1f (chars that never appear in commit text); --name-only appends the file
// list, which lands in the field after %b. Merges are skipped for a clean
// authoring history. Rebuilding after a `git pull` refreshes this automatically.
function gitLog() {
  const RS = '\x1e', US = '\x1f'
  try {
    const raw = execSync(
      `git log -n 500 --no-merges --pretty=format:'${RS}%H${US}%h${US}%an${US}%cI${US}%s${US}%b${US}' --name-only`,
      { maxBuffer: 64 * 1024 * 1024 }
    ).toString()
    return raw
      .split(RS)
      .filter((rec) => rec.includes(US))
      .map((rec) => {
        const parts = rec.split(US)
        const files = (parts[6] ?? '').split('\n').map((f) => f.trim()).filter(Boolean)
        return {
          hash:      (parts[0] ?? '').trim(),
          shortHash: (parts[1] ?? '').trim(),
          author:    (parts[2] ?? '').trim(),
          isoTime:   (parts[3] ?? '').trim(),
          subject:   (parts[4] ?? '').trim(),
          body:      (parts[5] ?? '').trim(),
          files,
        }
      })
  } catch {
    return []
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base so the same build works whether it's served from the
  // domain root or a subpath (e.g. nginx alias /gd4_simulator/) with zero
  // config per deployment. Safe because HashRouter keeps all routing in the
  // #/ fragment — the actual document path never changes depth.
  base: './',
  define: {
    __GIT_INFO__: JSON.stringify(gitInfo()),
    __GIT_LOG__: JSON.stringify(gitLog()),
  },
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
