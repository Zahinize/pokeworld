import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Serve /api/* in dev without the vercel CLI: route each request to the matching
 * handler in ./api via Vite's SSR module loader (TS on the fly + hot reload).
 * Handlers speak raw Node req/res, so no adapter is needed — the same code runs
 * here, under Vercel's Node runtime, and in scripts/apiCheck.ts.
 */
const apiDev = (): Plugin => ({
  name: 'pokeworld-api-dev',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/api', async (req, res) => {
      try {
        // connect strips the '/api' mount prefix from req.url
        const pathname = new URL(req.url ?? '/', 'http://x').pathname.replace(/\/+$/, '');
        if (!pathname || pathname.includes('..') || pathname.includes('_lib')) { res.statusCode = 404; return res.end(); }
        const mod = await server.ssrLoadModule(`/api${pathname}.ts`).catch(() => null);
        const handler = (mod as { default?: (rq: unknown, rs: unknown) => Promise<void> } | null)?.default;
        if (!handler) {
          res.statusCode = 404; res.setHeader('content-type', 'application/json');
          return res.end('{"error":"not_found"}');
        }
        await handler(req, res);
        if (!res.writableEnded) res.end();
      } catch (e) {
        server.ssrFixStacktrace(e as Error);
        console.error('[api-dev]', e);
        res.statusCode = 500; res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'internal' }));
      }
    });
  },
});

export default defineConfig(({ mode }) => {
  // let .env.local supply SESSION_SECRET / BLOB_READ_WRITE_TOKEN to the dev API
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of ['SESSION_SECRET', 'BLOB_READ_WRITE_TOKEN', 'DATA_DIR']) {
    if (env[k] && !process.env[k]) process.env[k] = env[k];
  }
  return {
    plugins: [react(), apiDev()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    server: { port: 5173, host: true },
    build: {
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            three: ['three'],
            r3f: ['@react-three/fiber', '@react-three/drei'],
            react: ['react', 'react-dom'],
          },
        },
      },
    },
  };
});
