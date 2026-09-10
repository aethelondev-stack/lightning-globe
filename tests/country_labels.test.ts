import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CountryLabelManager } from '../src/world/labels/CountryLabelManager';
import fs from 'node:fs';
import path from 'node:path';

describe('CountryLabelManager: Zero-Overhead Country Names & Positioning', () => {
  test('should handle headless / Node.js test environment gracefully without crashing', () => {
    const manager = new CountryLabelManager(100);
    assert.ok(manager.group);
    assert.strictEqual(manager.getIsEnabled(), true);

    // In headless Node.js without DOM canvas, initLabels should safely return
    manager.initLabels([{ properties: { name: 'Turkey' }, geometry: { type: 'Point', coordinates: [35, 38] } }]);
    assert.strictEqual(manager.group.children.length, 0);

    manager.update(250);
    manager.setEnabled(false);
    assert.strictEqual(manager.getIsEnabled(), false);
    manager.destroy();
  });

  test('should accurately parse largest polygon centroids for geographic features', () => {
    const geojsonPath = path.join(process.cwd(), 'public', 'data', 'countries.geojson');
    assert.ok(fs.existsSync(geojsonPath), 'public/data/countries.geojson must exist');

    const raw = fs.readFileSync(geojsonPath, 'utf8');
    const data = JSON.parse(raw);
    assert.ok(Array.isArray(data.features));
    assert.ok(data.features.length >= 200);

    // Private helper method access for algorithmic validation
    const manager = new CountryLabelManager(100) as any;

    const testCountries = ['United States', 'France', 'Turkey', 'Russia', 'Brazil'];

    for (const name of testCountries) {
      const feature = data.features.find((f: any) => f.properties.name === name);
      assert.ok(feature, `Feature for ${name} must be found in geojson`);

      const center = manager.getLargestPolygonCentroid(feature.geometry);
      assert.ok(center, `Centroid for ${name} must be calculated`);
      assert.ok(center.lat >= -90 && center.lat <= 90, `Latitude for ${name} out of range: ${center.lat}`);
      assert.ok(center.lon >= -180 && center.lon <= 180, `Longitude for ${name} out of range: ${center.lon}`);
      assert.ok(center.area > 0, `Area for ${name} must be positive: ${center.area}`);

      // Verification of geographic sanity
      if (name === 'Turkey') {
        assert.ok(center.lat > 36 && center.lat < 42, `Turkey latitude sanity check: ${center.lat}`);
        assert.ok(center.lon > 26 && center.lon < 45, `Turkey longitude sanity check: ${center.lon}`);
      } else if (name === 'United States') {
        // Main contiguous landmass should be around Kansas/Missouri/Illinois
        assert.ok(center.lat > 30 && center.lat < 48, `Contiguous US latitude sanity check: ${center.lat}`);
        assert.ok(center.lon < -70 && center.lon > -125, `Contiguous US longitude sanity check: ${center.lon}`);
      } else if (name === 'France') {
        // Metropolitan France
        assert.ok(center.lat > 42 && center.lat < 51, `Metropolitan France latitude check: ${center.lat}`);
        assert.ok(center.lon > -5 && center.lon < 10, `Metropolitan France longitude check: ${center.lon}`);
      }
    }
  });

  test('should calculate proportional scale according to country footprint without engulfing borders', () => {
    const geojsonPath = path.join(process.cwd(), 'public', 'data', 'countries.geojson');
    const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
    const manager = new CountryLabelManager(100) as any;

    const russia = data.features.find((f: any) => f.properties.name === 'Russia');
    const turkey = data.features.find((f: any) => f.properties.name === 'Turkey');
    const albania = data.features.find((f: any) => f.properties.name === 'Albania');

    const cRussia = manager.getLargestPolygonCentroid(russia.geometry);
    const cTurkey = manager.getLargestPolygonCentroid(turkey.geometry);
    const cAlbania = manager.getLargestPolygonCentroid(albania.geometry);

    assert.ok(cRussia.area > cTurkey.area, 'Russia area must be larger than Turkey');
    assert.ok(cTurkey.area > cAlbania.area, 'Turkey area must be larger than Albania');

    const scaleRussia = Math.max(1.2, Math.min(7.5, Math.sqrt(cRussia.area) * 0.26));
    const scaleTurkey = Math.max(1.2, Math.min(7.5, Math.sqrt(cTurkey.area) * 0.26));
    const scaleAlbania = Math.max(1.2, Math.min(7.5, Math.sqrt(cAlbania.area) * 0.26));

    assert.ok(scaleRussia > scaleTurkey, `Russia scale (${scaleRussia}) must be larger than Turkey (${scaleTurkey})`);
    assert.ok(scaleTurkey > scaleAlbania, `Turkey scale (${scaleTurkey}) must be larger than Albania (${scaleAlbania})`);
    assert.ok(scaleRussia <= 7.5, `Scale must not exceed maximum clamp (was ${scaleRussia})`);
    assert.ok(scaleAlbania >= 1.2, `Scale must not fall below minimum clamp (was ${scaleAlbania})`);
  });
});
