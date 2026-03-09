import * as s3 from './src/storage/s3.js';

async function checkStorage() {
  // Check March dates
  for (const date of ['2026-03-05', '2026-03-06', '2026-03-07']) {
    const keys = await s3.list(date + '/');
    console.log(`Found ${keys.length} keys for ${date}/:`);
    keys.forEach(k => console.log('  -', k));
  }

  // Also check if there are any keys at all
  const allKeys = await s3.list('');
  console.log(`\nTotal keys in bucket: ${allKeys.length}`);
  allKeys.slice(0, 10).forEach(k => console.log('  -', k));
}

checkStorage().catch(console.error);
