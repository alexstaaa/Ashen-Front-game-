import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Dev-only QA endpoint. Lets an automated browser session save a rendered
 * frame to disk (`qa/<name>.jpg`) so gameplay states can be reviewed as images
 * instead of described from memory. Never included in a production build.
 */
function qaFrameCapture() {
  return {
    name: 'ashen-qa-frame-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__qa/frame', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const url = new URL(req.url, 'http://localhost');
            const name = (url.searchParams.get('name') ?? 'frame').replace(/[^a-z0-9_-]/gi, '');
            const base64 = body.replace(/^data:image\/\w+;base64,/, '');
            const dir = resolve(process.cwd(), 'qa');
            mkdirSync(dir, { recursive: true });
            const file = resolve(dir, `${name}.jpg`);
            writeFileSync(file, Buffer.from(base64, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file, bytes: base64.length }));
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [qaFrameCapture()],
  // Relative asset paths so the build works from a GitHub Pages project
  // subpath (/<repo>/) as well as from a domain root.
  base: './',
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
