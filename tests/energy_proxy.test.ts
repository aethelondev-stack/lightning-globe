import test from 'node:test';
import assert from 'node:assert/strict';
import { EnergyProxy } from '../src/domain/energy/EnergyProxy';

test('EnergyProxy: clamps to lower bound 0.2 for zero and tiny current', () => {
  // 0 kA, 0 density -> raw 0.0 -> clamped 0.2
  const p0 = EnergyProxy.calculate(0, 0);
  assert.equal(p0, 0.2);

  // +5 kA, 0 density -> raw 0.65 * 0.05 = 0.0325 -> clamped 0.2
  const pTiny = EnergyProxy.calculate(5, 0);
  assert.equal(pTiny, 0.2);

  // Negative tiny current -3 kA, 1 density -> raw 0.65*0.03 + 0.35*0.1 = 0.0195 + 0.035 = 0.0545 -> clamped 0.2
  const pNegTiny = EnergyProxy.calculate(-3, 1);
  assert.equal(pNegTiny, 0.2);
});

test('EnergyProxy: clamps to upper bound 3.0 for extreme superbolts and dense storms', () => {
  // -200 kA, 50 density -> raw 0.65*2.0 + 0.35*5.0 = 1.30 + 1.75 = 3.05 -> clamped 3.0
  const pExtreme = EnergyProxy.calculate(-200, 50);
  assert.equal(pExtreme, 3.0);

  // Massive superbolt -500 kA
  const pSuperbolt = EnergyProxy.calculate(-500, 10);
  assert.equal(pSuperbolt, 3.0);
});

test('EnergyProxy: accurate weighted linear calculation within [0.2, 3.0]', () => {
  // 100 kA, 0 density -> 0.65 * 1.0 + 0.0 = 0.65
  const p1 = EnergyProxy.calculate(100, 0);
  assert.ok(Math.abs(p1 - 0.65) < 1e-6);

  // 0 kA, 10 density -> 0.0 + 0.35 * 1.0 = 0.35
  const p2 = EnergyProxy.calculate(0, 10);
  assert.ok(Math.abs(p2 - 0.35) < 1e-6);

  // 100 kA, 10 density -> 0.65 + 0.35 = 1.00
  const p3 = EnergyProxy.calculate(100, 10);
  assert.ok(Math.abs(p3 - 1.0) < 1e-6);

  // Sign symmetry: -75 kA == +75 kA
  const pPos = EnergyProxy.calculate(75, 4);
  const pNeg = EnergyProxy.calculate(-75, 4);
  assert.equal(pPos, pNeg);
});

test('EnergyProxy: scaling factors scale monotonically with energy', () => {
  const low = EnergyProxy.getScalingFactors(15, 1);
  const med = EnergyProxy.getScalingFactors(60, 5);
  const high = EnergyProxy.getScalingFactors(180, 20);

  assert.ok(low.energyProxy < med.energyProxy);
  assert.ok(med.energyProxy < high.energyProxy);

  // Shockwave max radius
  assert.ok(low.shockwaveMaxRadius < med.shockwaveMaxRadius);
  assert.ok(med.shockwaveMaxRadius < high.shockwaveMaxRadius);

  // Propagation speed
  assert.ok(low.shockwavePropagationSpeed < med.shockwavePropagationSpeed);
  assert.ok(med.shockwavePropagationSpeed < high.shockwavePropagationSpeed);

  // Point radius
  assert.ok(low.pointRadius < med.pointRadius);
  assert.ok(med.pointRadius < high.pointRadius);

  // Bolt intensity
  assert.ok(low.boltIntensity < med.boltIntensity);
  assert.ok(med.boltIntensity < high.boltIntensity);
});
