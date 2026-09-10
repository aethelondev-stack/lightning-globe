import fs from 'fs';
import path from 'path';

async function checkAttrs() {
  const h5wasm = await import('h5wasm');
  await h5wasm.ready;

  const filePath = path.resolve('scratch/sample_glm.nc');
  const buffer = fs.readFileSync(filePath);
  h5wasm.FS.writeFile('sample_attrs.nc', buffer);

  const file = new h5wasm.File('sample_attrs.nc', 'r');
  
  const vars = ['flash_lat', 'flash_lon', 'flash_energy', 'flash_area', 'flash_time_offset_of_first_event'];
  for (const v of vars) {
    const dataset = file.get(v);
    if (dataset) {
      console.log(`\nVariable [${v}]:`);
      console.log('  dtype:', dataset.dtype);
      console.log('  shape:', dataset.shape);
      const attrs = dataset.attrs;
      console.log('  attributes:', Object.keys(attrs).map(k => `${k}=${attrs[k].value}`).join(', '));
      console.log('  first 3 values:', Array.from(dataset.value).slice(0, 3));
    }
  }

  file.close();
}

checkAttrs().catch(console.error);
