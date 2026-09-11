import type { Plugin, ViteDevServer } from 'vite';
import { UnifiedLightningHub } from './UnifiedLightningHub';

/**
 * viteUnifiedHubPlugin: Mounts the Unified Lightning Hub routes on Vite dev server:
 * 1. GET /api/lightning/stream: Realtime Server-Sent Events (SSE) feed.
 *    - Instant 0ms RF pass-through.
 *    - Smoothly paced satellite micro-packets.
 * 2. GET /api/lightning/history-24h: Full 24-hour historical real strike archive.
 * 3. GET /api/lightning/stats: Live telemetry metrics.
 */
export function viteUnifiedHubPlugin(): Plugin {
  const attachRoutes = (middlewares: any) => {
    const hub = UnifiedLightningHub.getInstance();

    // 1. Server-Sent Events (SSE) stream endpoint
    middlewares.use('/api/lightning/stream', (req: any, res: any) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      const unregister = hub.registerSseClient(res);

      // Keep-alive heartbeat every 15s to prevent intermediate timeouts
      const keepAliveTimer = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch {
          clearInterval(keepAliveTimer);
          unregister();
        }
      }, 15000);

      req.on('close', () => {
        clearInterval(keepAliveTimer);
        unregister();
      });
    });

    // 2. 24-Hour Historical Backfill endpoint
    middlewares.use('/api/lightning/history-24h', (req: any, res: any) => {
      const url = new URL(req.url || '', 'http://localhost');
      const sinceStr = url.searchParams.get('since');
      const since = sinceStr ? parseInt(sinceStr, 10) : 0;

      const strikes = hub.get24hHistory(since);

      const payload = {
        status: 'OK',
        provider: 'Unified Lightning Ingest Hub (24h Real Archive)',
        timestamp: Date.now(),
        count: strikes.length,
        strikes
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(JSON.stringify(payload));
    });

    // 3. Status & Telemetry endpoint
    middlewares.use('/api/lightning/stats', (_req: any, res: any) => {
      const stats = hub.getStats();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(JSON.stringify(stats));
    });

    console.log('⚡ [UNIFIED HUB] SSE stream mounted at /api/lightning/stream');
    console.log('📂 [UNIFIED HUB] 24h History archive mounted at /api/lightning/history-24h');
  };

  return {
    name: 'vite-plugin-unified-hub',
    configureServer(server: ViteDevServer) {
      attachRoutes(server.middlewares);
    },
    configurePreviewServer(server: any) {
      attachRoutes(server.middlewares);
    }
  };
}
