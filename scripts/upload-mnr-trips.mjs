#!/usr/bin/env node
// Upload MNR trips data to Cloudflare KV
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('Reading MNR trips data...');
import mnrTrips from '../src/data/mnr-trips.js';
const tripsData = JSON.stringify(mnrTrips.byRouteTime);

console.log('Uploading to KV namespace MNR_TRIPS...');
// Use a temporary file to avoid command line length limits
const tmpPath = join(__dirname, '..', 'trips-upload.json');
writeFileSync(tmpPath, tripsData);

execSync(`npx wrangler kv key put --namespace-id f7afe1041c534774b6758a3ab8057b2c trips --path "${tmpPath}" --remote`, {
    cwd: join(__dirname, '..'),
    stdio: 'inherit'
});

unlinkSync(tmpPath);

console.log('Done!');
