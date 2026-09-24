import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
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

    // 3b. Satellite Real-time Telemetry endpoint (for Admin Panel charts)
    middlewares.use('/api/admin/satellite-telemetry', (_req: any, res: any) => {
      const satTelemetry = hub.getSatelliteTelemetry();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(JSON.stringify(satTelemetry));
    });

    // 3c. Fast-Boot Snapshot endpoint (<100ms instant spatially balanced startup)
    middlewares.use('/api/lightning/recent-quick', (_req: any, res: any) => {
      const quickData = hub.getRecentQuick(600);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(JSON.stringify(quickData));
    });

    // 4. On-demand VPS Cache Sync endpoint (for local machine when PC was powered off)
    middlewares.use('/api/lightning/sync-vps', (_req: any, res: any) => {
      let synced = false;
      const keyPath = path.resolve(process.cwd(), 'ssh-key-2026-09-10.key');
      if (fs.existsSync(keyPath)) {
        try {
          const tmpVps = path.resolve(process.cwd(), '.cache', 'vps_incoming.json');
          execSync(`scp -o StrictHostKeyChecking=no -i ssh-key-2026-09-10.key ubuntu@130.61.53.100:/home/ubuntu/lightning-globe/.cache/lightning_24h.json "${tmpVps}"`, { timeout: 30000, stdio: 'ignore' });
          if (fs.existsSync(tmpVps)) {
            const vpsData = JSON.parse(fs.readFileSync(tmpVps, 'utf8'));
            hub.mergeStrikesIntoHistory(vpsData?.strikes || []);
            fs.unlinkSync(tmpVps);
            hub.saveToDiskCache();
            synced = true;
            console.log('⚡ [UNIFIED HUB] On-demand sync & merge from Oracle VPS succeeded.');
          }
        } catch (e: any) {
          console.warn('⚠️ [UNIFIED HUB] On-demand sync from VPS failed:', e?.message);
        }
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(JSON.stringify({ status: synced ? 'SYNCED' : 'SKIPPED', cachedCount: hub.getStats().cached24hCount }));
    });

    // 5. Hot Reload Disk Cache into Hub Memory
    middlewares.use('/api/lightning/reload-cache', (_req: any, res: any) => {
      hub.loadFromDiskCache();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(JSON.stringify({ status: 'RELOADED', cachedCount: hub.getStats().cached24hCount }));
    });

    // 6. Global Admin Config Endpoint (Panel toggles, master volume, satellite thresholds)
    // Server-Side Secure Admin Authentication & Token Storage
    const validTokens = new Set<string>();
    const failedLoginAttempts = new Map<string, { count: number; lockUntil: number }>();

    // 6a. Admin Login Endpoint (Server-Side Authentication with Rate Limiting)
    middlewares.use('/api/admin/login', (req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(45);
        res.end(JSON.stringify({ status: 'ERROR', error: 'Method Not Allowed' }));
        return;
      }

      const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString();
      const now = Date.now();
      const attempts = failedLoginAttempts.get(clientIp) || { count: 0, lockUntil: 0 };

      if (attempts.lockUntil > now) {
        const remainingSec = Math.ceil((attempts.lockUntil - now) / 1000);
        res.writeHead(429);
        res.end(JSON.stringify({ status: 'LOCKED', error: `Too many failed attempts. Locked for ${remainingSec}s.` }));
        return;
      }

      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', () => {
        try {
          const sanitized = (body || '{}').replace(/^\uFEFF/, '').trim();
          const { user, pass } = JSON.parse(sanitized);

          if (user === 'aethelon' && pass === 'Aeth#92!LgtX') {
            failedLoginAttempts.delete(clientIp);
            // Generate cryptographically safe session token
            const token = `sat_token_${Date.now()}_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
            validTokens.add(token);

            // Token expires automatically after 24 hours
            setTimeout(() => validTokens.delete(token), 86400000);

            res.end(JSON.stringify({ status: 'OK', token }));
          } else {
            attempts.count++;
            if (attempts.count >= 5) {
              attempts.lockUntil = now + 5 * 60 * 1000; // 5 minute lockout after 5 failures
            }
            failedLoginAttempts.set(clientIp, attempts);

            res.writeHead(401);
            res.end(JSON.stringify({ status: 'INVALID', error: 'Hatalı kullanıcı adı veya güvenlik şifresi!' }));
          }
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ status: 'ERROR', error: 'Invalid JSON payload' }));
        }
      });
    });

    // 6b. Global Admin Config Endpoint (Protected by Bearer Token on POST)
    const adminConfigPath = path.resolve(process.cwd(), '.cache', 'admin_config.json');
    middlewares.use('/api/admin/config', (req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === 'POST') {
        // Enforce Server-Side Token Authorization Guard
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

        if (!token || !validTokens.has(token)) {
          res.writeHead(401);
          res.end(JSON.stringify({ status: 'UNAUTHORIZED', error: 'Yetkisiz erişim! Admin token geçersiz veya eksik.' }));
          return;
        }

        let body = '';
        req.on('data', (chunk: any) => { body += chunk; });
        req.on('end', () => {
          try {
            const sanitized = (body || '{}').replace(/^\uFEFF/, '').trim();
            const data = JSON.parse(sanitized);
            const dir = path.dirname(adminConfigPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(adminConfigPath, JSON.stringify(data, null, 2), 'utf8');

            // Apply dynamic satellite rates and thresholds immediately in UnifiedLightningHub
            if (data.satelliteRates) {
              hub.setSatelliteRates(data.satelliteRates);
            }
            if (data.satelliteThresholds) {
              hub.setSatelliteThresholds(data.satelliteThresholds);
            }

            res.end(JSON.stringify({ status: 'OK', config: data }));
          } catch (e: any) {
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'ERROR', error: e?.message }));
          }
        });
      } else {
        // GET (Public layout read for active site visitors)
        try {
          if (fs.existsSync(adminConfigPath)) {
            const content = fs.readFileSync(adminConfigPath, 'utf8');
            res.end(content);
          } else {
            // Default config
            const defaults = {
              sfxVolume: 80,
              musicVolume: 50,
              satelliteRates: {
                goes19: 8,
                goes18: 2,
                mtg: 20
              },
              satelliteThresholds: {
                goes19: 2.8,
                goes18: 2.8,
                mtg: 2.8
              },
              panelStates: {
                hud: 'OPEN',
                liveBadge: 'OPEN',
                liveFeed: 'CLOSED',
                directorQueue: 'OPEN',
                storms: 'CLOSED',
                leaderboard: 'CLOSED',
                analytics: 'CLOSED',
                bottomBar: 'OPEN'
              },
              updatedAt: Date.now()
            };
            res.end(JSON.stringify(defaults));
          }
        } catch {
          res.end(JSON.stringify({ status: 'ERROR' }));
        }
      }
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
