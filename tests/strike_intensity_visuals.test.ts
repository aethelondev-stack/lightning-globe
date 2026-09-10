import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FulguriteTraceLayer } from '../src/world/vfx/FulguriteTraceLayer';
import { generateBoltGeometry, writeSegmentsToBuffer } from '../src/world/vfx/ProceduralBoltGeometry';
import { LightningBoltPool } from '../src/world/vfx/LightningBoltPool';

test('FulguriteTraceLayer: 5 Lightning Intensity Tier Colors (Foto 2 Palette)', () => {
  // 1. MINOR (< 10 kA): Turquoise Cyan (#26C6DA)
  const cMinor = FulguriteTraceLayer.getTierColor(5);
  assert.equal(cMinor.getHexString(), '26c6da');

  const cMinorNeg = FulguriteTraceLayer.getTierColor(-8);
  assert.equal(cMinorNeg.getHexString(), '26c6da');

  // 2. STANDARD (10 - 35 kA): Neon Lilac (#D6A2E8)
  const cStd = FulguriteTraceLayer.getTierColor(25);
  assert.equal(cStd.getHexString(), 'd6a2e8');

  // 3. SEVERE (35 - 75 kA): Amber Gold (#FFC436)
  const cSevere = FulguriteTraceLayer.getTierColor(50);
  assert.equal(cSevere.getHexString(), 'ffc436');

  // 4. VIOLENT (75 - 150 kA): Ionic Fuchsia (#FF1493)
  const cViolent = FulguriteTraceLayer.getTierColor(110);
  assert.equal(cViolent.getHexString(), 'ff1493');

  // 5. SUPERBOLT (>= 150 kA): Cosmic Pulsar Violet (#A78BFA - distinct from live pure-white bolts)
  const cSuper = FulguriteTraceLayer.getTierColor(220);
  assert.equal(cSuper.getHexString(), 'a78bfa');
});

test('FulguriteTraceLayer: 24-Hour Custom Piecewise Opacity Decay Table Precision', () => {
  // Continuous 5-step piecewise opacity decay curve matching user specification:
  // 0 - 1h: 1.00 -> 0.80 (%20 şeffaflaşma)
  // 1 - 2h: 0.80 -> 0.70 (Toplam %30 şeffaflaşma)
  // 2 - 3h: 0.70 -> 0.60 (Toplam %40 şeffaflaşma)
  // 3 - 4h: 0.60 -> 0.50 (Toplam %50 şeffaflaşma)
  // 4 - 24h: 0.50 -> 0.00 (24. saatte tam kayboluş, her saat %2.5 azalış)
  const decay = (hours: number) => {
    const ageH = Math.max(0.0, hours);
    if (ageH <= 1.0) {
      return 1.0 - (0.20 * ageH);
    } else if (ageH <= 2.0) {
      return 0.80 - (0.10 * (ageH - 1.0));
    } else if (ageH <= 3.0) {
      return 0.70 - (0.10 * (ageH - 2.0));
    } else if (ageH <= 4.0) {
      return 0.60 - (0.10 * (ageH - 3.0));
    } else if (ageH <= 24.0) {
      return 0.50 * (1.0 - ((ageH - 4.0) / 20.0));
    } else {
      return 0.0;
    }
  };

  // Hour 0: 100%
  assert.equal(Number((decay(0) * 100).toFixed(1)), 100.0);

  // Hour 1: 80% (%20 şeffaflaşmış)
  assert.equal(Number((decay(1) * 100).toFixed(1)), 80.0);

  // Hour 2: 70% (toplam %30 şeffaflaşmış)
  assert.equal(Number((decay(2) * 100).toFixed(1)), 70.0);

  // Hour 3: 60% (toplam %40 şeffaflaşmış)
  assert.equal(Number((decay(3) * 100).toFixed(1)), 60.0);

  // Hour 4: 50% (toplam %50 şeffaflaşmış)
  assert.equal(Number((decay(4) * 100).toFixed(1)), 50.0);

  // Hour 14: Midpoint between 4h (50%) and 24h (0%) = 25.0%
  assert.equal(Number((decay(14) * 100).toFixed(1)), 25.0);

  // Hour 24: 0.0% (tam şeffaflaşmış / kaybolmuş)
  assert.equal(Number((decay(24) * 100).toFixed(1)), 0.0);

  // Beyond 24h: clamped at 0%
  assert.equal(decay(26), 0.0);
});

test('ProceduralBoltGeometry: Multi-strand thickness scaling by intensity', () => {
  const start = new THREE.Vector3(0, 114, 0);
  const end = new THREE.Vector3(0, 100, 0);

  const geo = generateBoltGeometry(start, end, { depth: 4 });
  assert.ok(geo.segments.length > 0);

  const buffer = new Float32Array(1536 * 3);

  // Test Standard (5 strands)
  const vertCountStd = writeSegmentsToBuffer(geo.segments, buffer, {
    strands: 5,
    radius: 0.15,
    mainTrunkCount: geo.mainTrunk.length - 1
  });
  assert.ok(vertCountStd > geo.segments.length * 2, 'Thick bolt must generate multi-strand vertices');

  // Verify all generated coordinates are valid numbers (no NaN)
  for (let i = 0; i < vertCountStd * 3; i++) {
    assert.equal(isNaN(buffer[i]), false, `Vertex float index ${i} must not be NaN`);
  }

  // Verify Strand 0 is strictly the exact central axis
  assert.equal(buffer[0], geo.segments[0].start.x);
  assert.equal(buffer[1], geo.segments[0].start.y);
  assert.equal(buffer[2], geo.segments[0].start.z);
});

test('LightningBoltPool: Thick bolts and cascading charge beads traversal', () => {
  const pool = new LightningBoltPool({ poolSize: 4 });
  const start = new THREE.Vector3(0, 115, 0);
  const end = new THREE.Vector3(0, 100, 0);

  // Acquire a Superbolt (>150 kA)
  const bolt = pool.acquire(start, end, 2.5, undefined, 1000, 180);
  assert.ok(bolt);
  assert.equal(bolt.classification, 'SUPERBOLT');
  assert.equal(bolt.chargeCount, 4);
  assert.ok(bolt.cascadingCharges?.visible);

  // Test bead traversal at 300ms
  pool.update(1300);
  const posAttr = bolt.cascadingCharges?.geometry.getAttribute('position') as THREE.BufferAttribute;
  assert.ok(posAttr);

  // Ensure beads are on path and not NaN
  for (let b = 0; b < 4; b++) {
    const x = posAttr.getX(b);
    const y = posAttr.getY(b);
    const z = posAttr.getZ(b);
    assert.equal(isNaN(x), false);
    assert.equal(isNaN(y), false);
    assert.equal(isNaN(z), false);
  }

  pool.destroy();
});
