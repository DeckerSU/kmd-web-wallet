import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// package.json is the single source of truth for the app version
// (major.minor.build) — see the versioning note in the README.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

/**
 * Generates dist/sw.js from sw/sw.template.js with the real, content-hashed
 * filenames baked in.
 *
 * A browser reinstalls a service worker only when the script's bytes change. A
 * static worker is byte-identical on every deploy, so `install` never runs
 * again and its cache stays frozen at whatever the first install captured —
 * which is how an installed app ends up requesting assets a later deploy has
 * already deleted. Embedding the filenames makes the script change exactly when
 * the build does.
 *
 * Runs at `closeBundle` and reads dist from disk, so the list reflects what was
 * actually emitted — including dynamic chunks, which are not referenced from
 * index.html and would be missed by parsing it.
 */
function swBuildManifest(): Plugin {
  return {
    name: 'sw-build-manifest',
    apply: 'build',
    closeBundle() {
      const outDir = 'dist'
      const assets = readdirSync(join(outDir, 'assets'))
        // The wasm is ~36 MB — far too large to precache, and its content hash
        // already makes the browser's own HTTP cache safe for it.
        .filter((f) => !f.endsWith('.wasm'))
        .map((f) => `/assets/${f}`)
        .sort()

      const precache = ['/index.html', ...assets]
      // Asset names are content hashes, so hashing the list is enough to change
      // the build id whenever anything in the build changes.
      const buildId = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)

      const template = readFileSync(join('sw', 'sw.template.js'), 'utf8')
      // replaceAll, not replace: the template's own doc comment names both
      // placeholders, and replacing only the first occurrence rewrites the
      // comment while leaving the constants untouched.
      const sw = template
        .replaceAll('__BUILD_ID__', buildId)
        .replaceAll('__PRECACHE__', JSON.stringify(precache, null, 2))

      if (sw.includes('__BUILD_ID__') || sw.includes('__PRECACHE__')) {
        throw new Error('sw.js still contains unreplaced placeholders')
      }

      writeFileSync(join(outDir, 'sw.js'), sw)
      this.info(`sw.js generated: build ${buildId}, ${precache.length} precached entries`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), swBuildManifest()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
