import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSensitivePath,
  secureCompare,
  getClientIp,
  isLocalhost,
  RateLimiter,
  sanitizeAdminConfig
} from '../server/viteUnifiedHubPlugin';

test('Security Audit: Sensitive File & Path Traversal Blocker', () => {
  // 1. Critical private keys & certificates must be blocked
  assert.equal(isSensitivePath('/ssh-key-2026-09-10.key'), true);
  assert.equal(isSensitivePath('/certs/server.pem'), true);
  assert.equal(isSensitivePath('/id_rsa.key'), true);

  // 2. Environment variables & git internals must be blocked
  assert.equal(isSensitivePath('/.env'), true);
  assert.equal(isSensitivePath('/.env.production'), true);
  assert.equal(isSensitivePath('/.git/config'), true);
  assert.equal(isSensitivePath('/.git/HEAD'), true);

  // 3. Cache and internal server/test directories must be blocked
  assert.equal(isSensitivePath('/.cache/lightning_24h.json'), true);
  assert.equal(isSensitivePath('/server/UnifiedLightningHub.ts'), true);
  assert.equal(isSensitivePath('/tests/ui.test.ts'), true);

  // 4. Scripts and build configs must be blocked
  assert.equal(isSensitivePath('/package.json'), true);
  assert.equal(isSensitivePath('/package-lock.json'), true);
  assert.equal(isSensitivePath('/tsconfig.json'), true);
  assert.equal(isSensitivePath('/CANLI_SIMSEK_BASLAT.bat'), true);
  assert.equal(isSensitivePath('/start_stream_display.sh'), true);
  assert.equal(isSensitivePath('/EUMETSAT_CREDENTIALS.md'), true);

  // 5. Path traversal attempts (encoded or raw) must be blocked
  assert.equal(isSensitivePath('/../etc/passwd'), true);
  assert.equal(isSensitivePath('/assets/../../ssh-key-2026-09-10.key'), true);
  assert.equal(isSensitivePath('/%2e%2e/server/UnifiedLightningHub.ts'), true);

  // 6. Query string & trailing slash evasion attempts must be blocked
  assert.equal(isSensitivePath('/ssh-key-2026-09-10.key?download=1'), true);
  assert.equal(isSensitivePath('/ssh-key-2026-09-10.key/'), true);
  assert.equal(isSensitivePath('//ssh-key-2026-09-10.key'), true);
  assert.equal(isSensitivePath('/AGENTS.md'), true);
  assert.equal(isSensitivePath('/README.md'), true);
  assert.equal(isSensitivePath('/vite.config.ts'), true);

  // 7. Normal legitimate client assets must be allowed
  assert.equal(isSensitivePath('/index.html'), false);
  assert.equal(isSensitivePath('/assets/index-BBuU9DwF.css'), false);
  assert.equal(isSensitivePath('/assets/index-C9rIm3H9.js'), false);
  assert.equal(isSensitivePath('/textures/earth-blue-marble.jpg'), false);
  assert.equal(isSensitivePath('/audio/ambient/01_stellardrone_eternity.mp3'), false);
});

test('Security Audit: Timing-Safe Credential Verification', () => {
  // Identical strings match
  assert.equal(secureCompare('aethelon', 'aethelon'), true);
  assert.equal(secureCompare('Aeth#92!LgtX', 'Aeth#92!LgtX'), true);

  // Mismatches return false without timing leaks
  assert.equal(secureCompare('aethelon', 'admin'), false);
  assert.equal(secureCompare('Aeth#92!LgtX', 'wrongpass'), false);
  assert.equal(secureCompare('Aeth#92!LgtX', 'Aeth#92!LgtY'), false);
  assert.equal(secureCompare('', 'Aeth#92!LgtX'), false);
});

test('Security Audit: Client IP Extraction & Localhost Detection', () => {
  // Direct remote connection
  const req1 = { socket: { remoteAddress: '198.51.100.5' }, headers: {} };
  assert.equal(getClientIp(req1), '198.51.100.5');
  assert.equal(isLocalhost(req1), false);

  // Behind reverse proxy with X-Real-IP
  const req2 = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '203.0.113.19' } };
  assert.equal(getClientIp(req2), '203.0.113.19');
  assert.equal(isLocalhost(req2), false);

  // Behind CDN with multiple hops in X-Forwarded-For
  const req3 = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.99, 10.0.0.1, 127.0.0.1' } };
  assert.equal(getClientIp(req3), '198.51.100.99');
  assert.equal(isLocalhost(req3), false);

  // IP spoofing attempt: external attacker forging X-Forwarded-For: 127.0.0.1
  const reqSpoofed = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '127.0.0.1' } };
  assert.equal(isLocalhost(reqSpoofed), false, 'Spoofed localhost in proxy headers must be rejected');

  // True Localhost (direct connection without proxy forwarding headers)
  const reqLocal1 = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  assert.equal(isLocalhost(reqLocal1), true);

  const reqLocal2 = { socket: { remoteAddress: '::1' }, headers: {} };
  assert.equal(isLocalhost(reqLocal2), true);
});

test('Security Audit: Rate Limiter Sliding Window and Eviction', () => {
  const limiter = new RateLimiter(60000);
  try {
    const key = 'test_ip_1';

    // Allow 3 requests in a 1000ms window
    assert.equal(limiter.checkLimit(key, 3, 1000).allowed, true);
    assert.equal(limiter.checkLimit(key, 3, 1000).allowed, true);
    assert.equal(limiter.checkLimit(key, 3, 1000).allowed, true);

    // 4th request must be rejected
    const blocked = limiter.checkLimit(key, 3, 1000);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec > 0);

    // Clear / reset
    limiter.clear();
    assert.equal(limiter.checkLimit(key, 3, 1000).allowed, true);
  } finally {
    limiter.destroy();
  }
});

test('Security Audit: Admin Configuration Schema Sanitization & Clamp', () => {
  // 1. Out-of-bounds rates and volumes must be strictly clamped
  const maliciousInput = {
    sfxVolume: 9999, // Exceeds 100
    musicVolume: -50, // Negative
    satelliteRates: {
      goes19: 99999, // Absurd rate (DDoS risk)
      goes18: -10, // Negative rate
      mtg: 15
    },
    satelliteThresholds: {
      goes19: 5.0e-8, // Exceeds upper limit (1e-10)
      goes18: -1.0, // Negative
      mtg: 2.8e-14
    },
    panelStates: {
      hud: 'MALICIOUS_STATE',
      liveBadge: 'OPEN',
      __proto__: { polluted: true } // Prototype pollution attempt
    },
    injectedField: 'rm -rf /'
  };

  const sanitized = sanitizeAdminConfig(maliciousInput);

  assert.equal(sanitized.sfxVolume, 100);
  assert.equal(sanitized.musicVolume, 0);
  assert.equal(sanitized.satelliteRates.goes19, 50, 'Max satellite rate must be clamped at 50/sec');
  assert.equal(sanitized.satelliteRates.goes18, 0, 'Negative rate must be clamped at 0');
  assert.equal(sanitized.satelliteRates.mtg, 15);
  assert.equal(sanitized.satelliteThresholds.goes19, 1e-10, 'Threshold must be clamped at 1e-10');
  assert.equal(sanitized.panelStates.liveBadge, 'OPEN');
  assert.equal(sanitized.panelStates.hud, undefined, 'Invalid panel state must be discarded');
  assert.equal((sanitized as any).injectedField, undefined, 'Unknown fields must not be persisted');
  assert.equal((Object.prototype as any).polluted, undefined, 'Prototype pollution must fail');

  // 2. Reject non-object payloads
  assert.throws(() => sanitizeAdminConfig(null));
  assert.throws(() => sanitizeAdminConfig('string'));
  assert.throws(() => sanitizeAdminConfig([1, 2, 3]));
});
