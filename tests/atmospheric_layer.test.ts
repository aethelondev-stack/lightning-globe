import test from 'node:test';
import assert from 'node:assert/strict';
import { AtmosphericPotentialLayer } from '../src/world/atmosphere/AtmosphericPotentialLayer';
import type { AtmosphericPotentialPoint } from '../src/types/atmosphere';

test('AtmosphericPotentialLayer - Layer ordering and instancing integrity', () => {
  const layer = new AtmosphericPotentialLayer();

  assert.ok(layer.group, 'Group should be created');
  assert.equal(layer.group.children.length, 1);

  const instanced = layer.group.children[0] as any;
  assert.equal(instanced.renderOrder, 3, 'Atmospheric layer must have renderOrder = 3 (underneath honeycombs 18-20 and bolts 30)');
  assert.equal(instanced.count, 0, 'Initially zero hotspots rendered');

  const testPoints: AtmosphericPotentialPoint[] = [
    {
      latitude: 25.0,
      longitude: -80.0,
      cape: 2400,
      liftedIndex: -5,
      convectivePrecipitation: 12,
      riskLevel: 'HIGH',
      potentialScore: 0.75,
      timestamp: Date.now()
    },
    {
      latitude: -3.0,
      longitude: -60.0,
      cape: 3100,
      liftedIndex: -7,
      convectivePrecipitation: 25,
      riskLevel: 'EXTREME',
      potentialScore: 0.95,
      timestamp: Date.now()
    }
  ];

  layer.updateHotspots(testPoints);
  assert.equal(instanced.count, 2, 'Should update instanced count to 2');

  // Toggle layer
  layer.setEnabled(false);
  assert.equal(layer.getEnabled(), false);
  assert.equal(layer.group.visible, false);

  layer.setEnabled(true);
  assert.equal(layer.getEnabled(), true);
  assert.equal(layer.group.visible, true);
});
