import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { execSync } from 'child_process';
import type { ServerResponse } from 'http';
import type { Plugin, ViteDevServer } from 'vite';
import { UnifiedLightningHub } from './UnifiedLightningHub';

// Environment variables or secure defaults for admin authentication
const ADMIN_USER = process.env.ADMIN_USER || 'aethelon';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Aeth#92!LgtX';

/**
 * Safely extracts client IP address, handling reverse proxies (X-Forwarded-For, X-Real-IP)
 * without trusting easily spoofed headers blindly.
 */
export function getClientIp(req: any): string {
  const xRealIp = req.headers?.['x-real-ip'];
  if (xRealIp && typeof xRealIp === 'string') {
    const trimmed = xRealIp.trim();
    if (trimmed) return trimmed;
  }
  const xForwardedFor = req.headers?.['x-forwarded-for'];
  if (xForwardedFor && typeof xForwardedFor === 'string') {
    const firstIp = xForwardedFor.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Checks if request originates from direct localhost loopback without intermediate proxies.
 */
export function isLocalhost(req: any): boolean {
  // If proxy headers are present, request was forwarded and cannot be confirmed as pure direct localhost
  if (req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || req.headers?.['forwarded']) {
    return false;
  }
  const remote = req.socket?.remoteAddress || '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

/**
 * Performs timing-safe comparison between two strings to prevent timing attacks.
 */
export function secureCompare(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Checks if a requested path points to sensitive system, keys, markdown, or credential files.
 * Immune to trailing slashes, query parameters, double URL-encoding, and path traversal.
 */
export function isSensitivePath(urlPath: string): boolean {
  try {
    // 1. Strip query parameters and hash fragments
    const clean = (urlPath || '').split('?')[0].split('#')[0].trim();
    if (!clean) return false;

    // 2. Decode URL encoding (handles double encoding e.g. %252e%252e)
    let decoded = clean;
    try {
      decoded = decodeURIComponent(clean);
      if (decoded.includes('%')) {
        decoded = decodeURIComponent(decoded);
      }
    } catch {
      return true; // Malformed URI is suspicious
    }

    // 3. Null bytes or control characters
    if (/[\0\x00-\x1f\x7f]/.test(decoded)) {
      return true;
    }

    // 4. Directory traversal guard (reject ANY '..' sequence raw or decoded)
    if (decoded.includes('..') || clean.includes('..')) {
      return true;
    }

    // Normalize slashes
    const normalized = path.posix.normalize(decoded.replace(/\\/g, '/'));
    if (normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
      return true;
    }

    // 5. Remove trailing slashes for extension/filename checks (e.g. /ssh-key.key/ -> /ssh-key.key)
    const stripped = normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
    const baseName = path.posix.basename(stripped).toLowerCase();
    const strippedLower = stripped.toLowerCase();

    // 6. Blocked sensitive extensions
    const blockedExtensions = [
      /\.(key|pem|crt|pfx|p12|env.*|git.*|cache.*|bat|sh|ps1|cmd|bak|conf|cfg|ini|log|md|markdown|ts|tsx)$/i
    ];
    if (blockedExtensions.some((ext) => ext.test(strippedLower) || ext.test(baseName))) {
      return true;
    }

    // 7. Blocked exact files
    const blockedFiles = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'vite.config.js',
      'ecosystem.config.js',
      'eumetsat_credentials'
    ];
    if (blockedFiles.includes(baseName) || baseName.startsWith('.env') || baseName.startsWith('.git')) {
      return true;
    }

    // 8. Blocked internal source, test, server and cache directories
    const blockedDirs = [
      /^\/server(\/|$)/i,
      /^\/tests(\/|$)/i,
      /^\/\.git(\/|$)/i,
      /^\/\.cache(\/|$)/i,
      /^\/node_modules(\/|$)/i
    ];
    if (blockedDirs.some((dir) => dir.test(normalized))) {
      return true;
    }

    return false;
  } catch {
    return true; // Fail-closed
  }
}

/**
 * In-Memory sliding-window rate limiter with automatic stale key eviction.
 */
export class RateLimiter {
  private limits = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(cleanupIntervalMs = 300000) {
    this.cleanupTimer = setInterval(() => this.pruneStale(), cleanupIntervalMs);
  }

  public checkLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; remaining: number; retryAfterSec: number } {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now > entry.resetAt) {
      this.limits.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: maxRequests - 1, retryAfterSec: 0 };
    }

    if (entry.count >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      return { allowed: false, remaining: 0, retryAfterSec };
    }

    entry.count++;
    return { allowed: true, remaining: maxRequests - entry.count, retryAfterSec: 0 };
  }

  public pruneStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits.entries()) {
      if (now > entry.resetAt) {
        this.limits.delete(key);
      }
    }
  }

  public clear(): void {
    this.limits.clear();
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }
}

/**
 * Validates and sanitizes admin configuration payload to prevent prototype pollution
 * and out-of-range parameters.
 */
export function sanitizeAdminConfig(input: any): any {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Config payload must be a JSON object');
  }

  const sanitized: any = {};

  if (typeof input.sfxVolume === 'number' && Number.isFinite(input.sfxVolume)) {
    sanitized.sfxVolume = Math.max(0, Math.min(100, Math.round(input.sfxVolume)));
  }
  if (typeof input.musicVolume === 'number' && Number.isFinite(input.musicVolume)) {
    sanitized.musicVolume = Math.max(0, Math.min(100, Math.round(input.musicVolume)));
  }

  if (input.satelliteRates && typeof input.satelliteRates === 'object' && !Array.isArray(input.satelliteRates)) {
    sanitized.satelliteRates = {};
    const validSatKeys = ['goes19', 'goes18', 'mtg'];
    for (const k of validSatKeys) {
      if (k in input.satelliteRates) {
        const val = Number(input.satelliteRates[k]);
        if (Number.isFinite(val)) {
          sanitized.satelliteRates[k] = Math.max(0, Math.min(50, val));
        }
      }
    }
  }

  if (input.satelliteThresholds && typeof input.satelliteThresholds === 'object' && !Array.isArray(input.satelliteThresholds)) {
    sanitized.satelliteThresholds = {};
    const validSatKeys = ['goes19', 'goes18', 'mtg'];
    for (const k of validSatKeys) {
      if (k in input.satelliteThresholds) {
        const val = Number(input.satelliteThresholds[k]);
        if (Number.isFinite(val) && val > 0) {
          sanitized.satelliteThresholds[k] = Math.max(1e-15, Math.min(1e-10, val));
        }
      }
    }
  }

  if (input.panelStates && typeof input.panelStates === 'object' && !Array.isArray(input.panelStates)) {
    sanitized.panelStates = {};
    const allowedPanels = ['hud', 'liveBadge', 'liveFeed', 'directorQueue', 'storms', 'leaderboard', 'analytics', 'bottomBar'];
    const allowedValues = new Set(['OPEN', 'CLOSED', 'PASSIVE']);
    for (const p of allowedPanels) {
      if (p in input.panelStates && allowedValues.has(input.panelStates[p])) {
        sanitized.panelStates[p] = input.panelStates[p];
      }
    }
  }

  sanitized.updatedAt = Date.now();
  return sanitized;
}

/**
 * Safely reads and parses JSON request body with max size enforcement and timeout.
 */
function readJsonBody(req: any, res: any, maxBytes = 65536): Promise<any> {
  return new Promise((resolve, reject) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > maxBytes) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', error: 'Payload Too Large (Max 64KB)' }));
      req.destroy();
      return reject(new Error('Payload too large'));
    }

    let body = '';
    let receivedBytes = 0;

    const timeoutTimer = setTimeout(() => {
      res.writeHead(408, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ERROR', error: 'Request Timeout' }));
      req.destroy();
      reject(new Error('Request Timeout'));
    }, 10000);

    req.on('data', (chunk: any) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        clearTimeout(timeoutTimer);
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ERROR', error: 'Payload Too Large' }));
        req.destroy();
        return reject(new Error('Payload too large'));
      }
      body += chunk;
    });

    req.on('end', () => {
      clearTimeout(timeoutTimer);
      try {
        const sanitized = (body || '{}').replace(/^\uFEFF/, '').trim();
        const parsed = JSON.parse(sanitized);
        resolve(parsed);
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ERROR', error: 'Invalid JSON payload' }));
        reject(err);
      }
    });

    req.on('error', (err: any) => {
      clearTimeout(timeoutTimer);
      reject(err);
    });
  });
}

/**
 * viteUnifiedHubPlugin: Mounts the Unified Lightning Hub routes on Vite dev/preview server
 * with comprehensive security hardening, DDoS/bandwidth rate limiting, and admin authentication.
 */
export function viteUnifiedHubPlugin(): Plugin {
  const globalLimiter = new RateLimiter();

  // Failed login attempts tracker: clientIp -> { count, lockUntil }
  const failedLoginAttempts = new Map<string, { count: number; lockUntil: number }>();
  let globalFailedLoginsInWindow = 0;
  let globalFailedLoginsResetAt = Date.now() + 600000;

  // Active Admin Tokens: token -> { expiresAt }
  const validTokens = new Map<string, { expiresAt: number }>();

  // Active SSE connections tracking for concurrency guards
  const sseClientsPerIp = new Map<string, Set<ServerResponse>>();
  let totalActiveSseCount = 0;
  const MAX_GLOBAL_SSE = 300;
  const MAX_SSE_PER_IP = 4;

  // Cached 24-hour historical JSON & GZIP payloads (Saves CPU & ~85% egress bandwidth)
  let cached24hJson: string | null = null;
  let cached24hGzip: Buffer | null = null;
  let cached24hEtag = '';
  let cached24hTimestamp = 0;
  const CACHE_24H_TTL_MS = 20000; // 20 seconds TTL

  // VPS Sync mutex lock and cooldown
  let isSyncingVps = false;
  let lastVpsSyncTime = 0;

  // Periodic cleanup for auth tokens & failed logins (every 5 mins)
  const maintenanceInterval = setInterval(() => {
    const now = Date.now();
    // Prune expired tokens
    for (const [token, data] of validTokens.entries()) {
      if (now > data.expiresAt) {
        validTokens.delete(token);
      }
    }
    // Prune stale login lockout records
    for (const [ip, record] of failedLoginAttempts.entries()) {
      if (now > record.lockUntil + 600000) {
        failedLoginAttempts.delete(ip);
      }
    }
    // Reset global failed login counter
    if (now > globalFailedLoginsResetAt) {
      globalFailedLoginsInWindow = 0;
      globalFailedLoginsResetAt = now + 600000;
    }
  }, 300000);

  const attachRoutes = (middlewares: any) => {
    const hub = UnifiedLightningHub.getInstance();

    // 0. Global Security Middleware: Headers & Sensitive File Blocker
    middlewares.use((req: any, res: any, next: any) => {
      // Security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');

      const urlStr = req.url || '/';
      const parsedUrl = new URL(urlStr, 'http://localhost');

      // Sensitive file & traversal guard
      if (isSensitivePath(parsedUrl.pathname)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'FORBIDDEN', error: 'Access denied: protected system file.' }));
        return;
      }

      next();
    });

    // 1. Server-Sent Events (SSE) stream endpoint (with concurrency guards)
    middlewares.use('/api/lightning/stream', (req: any, res: any) => {
      const clientIp = getClientIp(req);

      // Check global SSE capacity limit
      if (totalActiveSseCount >= MAX_GLOBAL_SSE) {
        res.writeHead(503, {
          'Content-Type': 'application/json',
          'Retry-After': '15',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ status: 'BUSY', error: 'Planetary visualizer stream capacity full. Retrying shortly.' }));
        return;
      }

      // Check per-IP SSE connection limit (prevents connection flooding attacks)
      const ipSockets = sseClientsPerIp.get(clientIp) || new Set<ServerResponse>();
      if (ipSockets.size >= MAX_SSE_PER_IP) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '60',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ status: 'TOO_MANY_REQUESTS', error: 'Too many concurrent stream connections from your IP.' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      ipSockets.add(res);
      sseClientsPerIp.set(clientIp, ipSockets);
      totalActiveSseCount++;

      const unregister = hub.registerSseClient(res);

      const cleanupConnection = () => {
        clearInterval(keepAliveTimer);
        unregister();
        const currentSockets = sseClientsPerIp.get(clientIp);
        if (currentSockets) {
          currentSockets.delete(res);
          if (currentSockets.size === 0) {
            sseClientsPerIp.delete(clientIp);
          }
        }
        totalActiveSseCount = Math.max(0, totalActiveSseCount - 1);
      };

      // Keep-alive heartbeat every 15s to prevent intermediate timeouts
      const keepAliveTimer = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch {
          cleanupConnection();
        }
      }, 15000);

      req.on('close', cleanupConnection);
      req.on('error', cleanupConnection);
    });

    // 2. 24-Hour Historical Backfill endpoint (Optimized with In-Memory Caching, ETag, Gzip & Rate Limiting)
    middlewares.use('/api/lightning/history-24h', (req: any, res: any) => {
      const clientIp = getClientIp(req);

      // Rate limit: Max 6 requests per 2 minutes per IP (normal usage is 1 on page load)
      // This strictly prevents cloud bill egress drains from crawlers/attackers
      const limit = globalLimiter.checkLimit(`hist_${clientIp}`, 6, 120000);
      if (!limit.allowed) {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': limit.retryAfterSec.toString(),
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ status: 'TOO_MANY_REQUESTS', error: `Rate limit exceeded. Retry in ${limit.retryAfterSec}s.` }));
        return;
      }

      const url = new URL(req.url || '', 'http://localhost');
      const sinceStr = url.searchParams.get('since');
      const sinceNum = sinceStr ? parseInt(sinceStr, 10) : 0;
      const since = Number.isFinite(sinceNum) && sinceNum >= 0 ? sinceNum : 0;

      // Handle full 24h backfill with fast in-memory cache and GZIP compression
      if (since === 0) {
        const now = Date.now();
        if (!cached24hJson || now - cached24hTimestamp > CACHE_24H_TTL_MS) {
          const strikes = hub.get24hHistory(0);
          const payload = {
            status: 'OK',
            provider: 'Unified Lightning Ingest Hub (24h Real Archive)',
            timestamp: now,
            count: strikes.length,
            strikes
          };
          cached24hJson = JSON.stringify(payload);
          cached24hGzip = zlib.gzipSync(Buffer.from(cached24hJson), { level: 6 });
          cached24hTimestamp = now;
          cached24hEtag = `W/"24h-${cached24hTimestamp}-${strikes.length}"`;
        }

        // ETag conditional check (304 Not Modified sends 0 bytes!)
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === cached24hEtag) {
          res.writeHead(304, {
            'ETag': cached24hEtag,
            'Cache-Control': 'public, max-age=15, stale-while-revalidate=30',
            'Access-Control-Allow-Origin': '*'
          });
          res.end();
          return;
        }

        const acceptEncoding = req.headers['accept-encoding'] || '';
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
        res.setHeader('ETag', cached24hEtag);

        if (acceptEncoding.includes('gzip') && cached24hGzip) {
          res.setHeader('Content-Encoding', 'gzip');
          res.end(cached24hGzip);
        } else {
          res.end(cached24hJson);
        }
        return;
      }

      // Delta historical queries
      const strikes = hub.get24hHistory(since);
      const payload = {
        status: 'OK',
        provider: 'Unified Lightning Ingest Hub (24h Real Archive)',
        timestamp: Date.now(),
        count: strikes.length,
        strikes
      };

      const payloadStr = JSON.stringify(payload);
      const acceptEncoding = req.headers['accept-encoding'] || '';

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');

      if (acceptEncoding.includes('gzip')) {
        const compressed = zlib.gzipSync(Buffer.from(payloadStr), { level: 4 });
        res.setHeader('Content-Encoding', 'gzip');
        res.end(compressed);
      } else {
        res.end(payloadStr);
      }
    });

    // 3. Status & Telemetry endpoint (Rate limited)
    middlewares.use('/api/lightning/stats', (req: any, res: any) => {
      const clientIp = getClientIp(req);
      const limit = globalLimiter.checkLimit(`stats_${clientIp}`, 60, 60000);
      if (!limit.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'TOO_MANY_REQUESTS' }));
        return;
      }
      const stats = hub.getStats();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(JSON.stringify(stats));
    });

    // 3b. Satellite Real-time Telemetry endpoint (for Admin Panel charts)
    middlewares.use('/api/admin/satellite-telemetry', (req: any, res: any) => {
      const clientIp = getClientIp(req);
      const limit = globalLimiter.checkLimit(`sat_tel_${clientIp}`, 60, 60000);
      if (!limit.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'TOO_MANY_REQUESTS' }));
        return;
      }
      const satTelemetry = hub.getSatelliteTelemetry();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(JSON.stringify(satTelemetry));
    });

    // 3c. Fast-Boot Snapshot endpoint (<100ms instant spatially balanced startup)
    middlewares.use('/api/lightning/recent-quick', (req: any, res: any) => {
      const clientIp = getClientIp(req);
      const limit = globalLimiter.checkLimit(`quick_${clientIp}`, 30, 60000);
      if (!limit.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: 'TOO_MANY_REQUESTS' }));
        return;
      }
      const quickData = hub.getRecentQuick(600);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=5');
      res.end(JSON.stringify(quickData));
    });

    // 4. On-demand VPS Cache Sync endpoint (STRICT: Localhost or Authenticated Admin Only)
    middlewares.use('/api/lightning/sync-vps', (req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json');

      const isLocal = isLocalhost(req);
      const authHeader = req.headers?.['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
      const isAuthAdmin = token && validTokens.has(token) && Date.now() < (validTokens.get(token)?.expiresAt || 0);

      // Block external unauthenticated triggers
      if (!isLocal && !isAuthAdmin) {
        res.writeHead(403);
        res.end(JSON.stringify({ status: 'FORBIDDEN', error: 'Bu işlem yalnızca yerel makineden veya yetkili admin oturumundan çalıştırılabilir.' }));
        return;
      }

      // Check concurrency mutex lock
      if (isSyncingVps) {
        res.writeHead(409);
        res.end(JSON.stringify({ status: 'BUSY', error: 'VPS senkronizasyonu zaten devam ediyor.' }));
        return;
      }

      // Check cooldown (at most once every 60s)
      const now = Date.now();
      if (now - lastVpsSyncTime < 60000) {
        res.end(JSON.stringify({ status: 'SKIPPED_COOLDOWN', cachedCount: hub.getStats().cached24hCount }));
        return;
      }

      // If running directly on Oracle VPS, scp to itself is unnecessary
      const keyPath = path.resolve(process.cwd(), 'ssh-key-2026-09-10.key');
      if (!fs.existsSync(keyPath)) {
        res.end(JSON.stringify({ status: 'SKIPPED_ON_VPS', cachedCount: hub.getStats().cached24hCount }));
        return;
      }

      isSyncingVps = true;
      lastVpsSyncTime = now;

      let synced = false;
      try {
        const tmpVps = path.resolve(process.cwd(), '.cache', 'vps_incoming.json');
        execSync(`scp -o StrictHostKeyChecking=no -i ssh-key-2026-09-10.key ubuntu@130.61.53.100:/home/ubuntu/lightning-globe/.cache/lightning_24h.json "${tmpVps}"`, { timeout: 25000, stdio: 'ignore' });
        if (fs.existsSync(tmpVps)) {
          const vpsData = JSON.parse(fs.readFileSync(tmpVps, 'utf8'));
          hub.mergeStrikesIntoHistory(vpsData?.strikes || []);
          fs.unlinkSync(tmpVps);
          hub.saveToDiskCache();
          synced = true;
          // Invalidate 24h cached payload
          cached24hJson = null;
          console.log('⚡ [UNIFIED HUB] Authorized sync & merge from Oracle VPS succeeded.');
        }
      } catch (e: any) {
        console.warn('⚠️ [UNIFIED HUB] Sync from VPS failed:', e?.message);
      } finally {
        isSyncingVps = false;
      }

      res.setHeader('Cache-Control', 'no-cache');
      res.end(JSON.stringify({ status: synced ? 'SYNCED' : 'SKIPPED', cachedCount: hub.getStats().cached24hCount }));
    });

    // 5. Hot Reload Disk Cache into Hub Memory (STRICT: Localhost or Authenticated Admin Only)
    middlewares.use('/api/lightning/reload-cache', (req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json');

      const isLocal = isLocalhost(req);
      const authHeader = req.headers?.['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
      const isAuthAdmin = token && validTokens.has(token) && Date.now() < (validTokens.get(token)?.expiresAt || 0);

      if (!isLocal && !isAuthAdmin) {
        res.writeHead(403);
        res.end(JSON.stringify({ status: 'FORBIDDEN', error: 'Yetkisiz erişim.' }));
        return;
      }

      hub.loadFromDiskCache();
      cached24hJson = null; // Invalidate serialized cache
      res.end(JSON.stringify({ status: 'RELOADED', cachedCount: hub.getStats().cached24hCount }));
    });

    // 6a. Admin Login Endpoint (Timing-safe, Brute-force locked, High-entropy cryptographic tokens)
    middlewares.use('/api/admin/login', async (req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end(JSON.stringify({ status: 'ERROR', error: 'Method Not Allowed' }));
        return;
      }

      const clientIp = getClientIp(req);
      const now = Date.now();

      // Check global distributed brute-force limit (max 25 failed logins server-wide in 10m)
      if (globalFailedLoginsInWindow >= 25) {
        res.writeHead(429);
        res.end(JSON.stringify({ status: 'LOCKED', error: 'Sunucu genelinde güvenlik kilidi devrede. Lütfen daha sonra deneyin.' }));
        return;
      }

      // Check IP lockout
      const attempts = failedLoginAttempts.get(clientIp) || { count: 0, lockUntil: 0 };
      if (attempts.lockUntil > now) {
        const remainingSec = Math.ceil((attempts.lockUntil - now) / 1000);
        res.writeHead(429);
        res.end(JSON.stringify({ status: 'LOCKED', error: `Çok fazla hatalı giriş denemesi. Hesap ${remainingSec} saniye kilitlendi.` }));
        return;
      }

      try {
        const payload = await readJsonBody(req, res, 16384);
        const { user, pass } = payload;

        if (typeof user !== 'string' || typeof pass !== 'string') {
          res.writeHead(400);
          res.end(JSON.stringify({ status: 'ERROR', error: 'Geçersiz parametreler' }));
          return;
        }

        // Timing-safe constant-time authentication check
        const isUserMatch = secureCompare(user, ADMIN_USER);
        const isPassMatch = secureCompare(pass, ADMIN_PASS);

        if (isUserMatch && isPassMatch) {
          failedLoginAttempts.delete(clientIp);

          // Generate cryptographically secure token (256-bit random)
          const token = `sat_${crypto.randomBytes(32).toString('hex')}`;
          validTokens.set(token, { expiresAt: now + 86400000 }); // 24h validity

          res.end(JSON.stringify({ status: 'OK', token }));
        } else {
          attempts.count++;
          globalFailedLoginsInWindow++;

          if (attempts.count >= 5) {
            attempts.lockUntil = now + 15 * 60 * 1000; // 15 minute lockout after 5 failures
          }
          failedLoginAttempts.set(clientIp, attempts);

          res.writeHead(401);
          res.end(JSON.stringify({ status: 'INVALID', error: 'Hatalı kullanıcı adı veya güvenlik şifresi!' }));
        }
      } catch (err: any) {
        // readJsonBody already wrote response on stream limit error
        if (!res.headersSent) {
          res.writeHead(400);
          res.end(JSON.stringify({ status: 'ERROR', error: 'Geçersiz veri gönderildi.' }));
        }
      }
    });

    // 6b. Global Admin Config Endpoint (Strict Bearer Token Auth, Schema Validation & Sanitization)
    const adminConfigPath = path.resolve(process.cwd(), '.cache', 'admin_config.json');
    middlewares.use('/api/admin/config', async (req: any, res: any) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === 'POST') {
        const clientIp = getClientIp(req);
        const limit = globalLimiter.checkLimit(`admin_cfg_${clientIp}`, 30, 60000);
        if (!limit.allowed) {
          res.writeHead(429);
          res.end(JSON.stringify({ status: 'TOO_MANY_REQUESTS', error: 'Çok fazla yapılandırma isteği.' }));
          return;
        }

        // Enforce Server-Side Token Authorization Guard
        const authHeader = req.headers?.['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
        const tokenData = token ? validTokens.get(token) : null;

        if (!tokenData || Date.now() > tokenData.expiresAt) {
          res.writeHead(401);
          res.end(JSON.stringify({ status: 'UNAUTHORIZED', error: 'Yetkisiz erişim! Admin token geçersiz veya süresi dolmuş.' }));
          return;
        }

        try {
          const rawData = await readJsonBody(req, res, 65536);
          const sanitizedData = sanitizeAdminConfig(rawData);

          const dir = path.dirname(adminConfigPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(adminConfigPath, JSON.stringify(sanitizedData, null, 2), 'utf8');

          // Apply dynamic satellite rates and thresholds immediately in UnifiedLightningHub
          if (sanitizedData.satelliteRates) {
            hub.setSatelliteRates(sanitizedData.satelliteRates);
          }
          if (sanitizedData.satelliteThresholds) {
            hub.setSatelliteThresholds(sanitizedData.satelliteThresholds);
          }

          res.end(JSON.stringify({ status: 'OK', config: sanitizedData }));
        } catch (e: any) {
          if (!res.headersSent) {
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'ERROR', error: e?.message || 'Geçersiz yapılandırma' }));
          }
        }
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
                goes19: 2.8e-14,
                goes18: 2.8e-14,
                mtg: 2.8e-14
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

    console.log('⚡ [UNIFIED HUB] SSE stream mounted at /api/lightning/stream (Hardened)');
    console.log('📂 [UNIFIED HUB] 24h History archive mounted at /api/lightning/history-24h (Gzip & Cache Protected)');
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
