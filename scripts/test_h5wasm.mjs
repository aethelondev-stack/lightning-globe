import fs from 'fs';
import path from 'path';

async function testH5Wasm() {
  const h5wasm = await import('h5wasm');
  await h5wasm.ready;
  console.log('✅ h5wasm is ready!');

  const filePath = path.resolve('scratch/sample_glm.nc');
  const buffer = fs.readFileSync(filePath);

  const vfileName = 'sample.nc';
  h5wasm.FS.writeFile(vfileName, buffer);

  const file = new h5wasm.File(vfileName, 'r');
  console.log('✅ Opened HDF5 file successfully!');

  // Check flash variables
  const flashLat = file.get('flash_lat');
  const flashLon = file.get('flash_lon');
  const flashEnergy = file.get('flash_energy');
  const flashArea = file.get('flash_area');
  const flashTimeOffset = file.get('flash_time_offset_of_first_event');

  if (flashLat && flashLon) {
    const lats = flashLat.value;
    const lons = flashLon.value;
    const energies = flashEnergy ? flashEnergy.value : [];
    const areas = flashArea ? flashArea.value : [];
    const timeOffsets = flashTimeOffset ? flashTimeOffset.value : [];

    console.log(`⚡ Total flashes in this 20-second window: ${lats.length}`);
    for (let i = 0; i < Math.min(5, lats.length); i++) {
      console.log(`   [Flash ${i + 1}] Lat: ${lats[i].toFixed(3)}, Lon: ${lons[i].toFixed(3)}, Energy: ${energies[i]} J, Area: ${areas[i]} km²`);
    }

    // Check how many are in South America (Lat between -55 and +12, Lon between -82 and -34)
    let saCount = 0;
    for (let i = 0; i < lats.length; i++) {
      if (lats[i] >= -55 && lats[i] <= 12 && lons[i] >= -82 && lons[i] <= -34) {
        saCount++;
      }
    }
    console.log(`🌎 South America flashes in this file: ${saCount} / ${lats.length}`);
  } else {
    console.log('flash_lat or flash_lon not found. Available keys:', file.keys());
  }

  file.close();
}

testH5Wasm().catch(console.error);
