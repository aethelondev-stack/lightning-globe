async function findLatestGlmFile() {
  console.log('Finding latest NOAA GOES-16 GLM file in S3...');
  const t0 = Date.now();
  
  // 1. Find latest year
  const rYears = await fetch('https://noaa-goes16.s3.amazonaws.com/?prefix=GLM-L2-LCFA/&delimiter=/');
  const xmlYears = await rYears.text();
  const years = [...xmlYears.matchAll(/<Prefix>GLM-L2-LCFA\/([^/]+)\/<\/Prefix>/g)].map(m => m[1]);
  if (!years.length) throw new Error('No GLM years found in S3');
  const latestYear = years[years.length - 1];

  // 2. Find latest day
  const rDays = await fetch(`https://noaa-goes16.s3.amazonaws.com/?prefix=GLM-L2-LCFA/${latestYear}/&delimiter=/`);
  const xmlDays = await rDays.text();
  const days = [...xmlDays.matchAll(/<Prefix>GLM-L2-LCFA\/\d+\/([^/]+)\/<\/Prefix>/g)].map(m => m[1]);
  if (!days.length) throw new Error(`No days found for year ${latestYear}`);
  const latestDay = days[days.length - 1];

  // 3. Find latest hour
  const rHours = await fetch(`https://noaa-goes16.s3.amazonaws.com/?prefix=GLM-L2-LCFA/${latestYear}/${latestDay}/&delimiter=/`);
  const xmlHours = await rHours.text();
  const hours = [...xmlHours.matchAll(/<Prefix>GLM-L2-LCFA\/\d+\/\d+\/([^/]+)\/<\/Prefix>/g)].map(m => m[1]);
  if (!hours.length) throw new Error(`No hours found for day ${latestDay}`);
  const latestHour = hours[hours.length - 1];

  // 4. Find latest files in this hour
  const rFiles = await fetch(`https://noaa-goes16.s3.amazonaws.com/?prefix=GLM-L2-LCFA/${latestYear}/${latestDay}/${latestHour}/`);
  const xmlFiles = await rFiles.text();
  const keys = [...xmlFiles.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]).filter(k => k.endsWith('.nc'));
  if (!keys.length) throw new Error(`No files found in hour ${latestHour}`);

  const latestFile = keys[keys.length - 1];
  console.log(`✅ Found latest file in ${Date.now() - t0}ms: ${latestFile}`);
  return latestFile;
}

findLatestGlmFile().catch(console.error);
