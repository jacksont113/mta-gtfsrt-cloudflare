import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const stopsFilePath = process.argv[2];
const outputPath = process.argv[3] || path.join(__dirname, '../src/data/mnr-stops.js');

if (!stopsFilePath) {
    console.error('Usage: node generate-mnr-stops.mjs <stops.txt> [output.js]');
    process.exit(1);
}

if (!fs.existsSync(stopsFilePath)) {
    console.error(`Error: File not found: ${stopsFilePath}`);
    process.exit(1);
}

console.log(`Reading ${stopsFilePath}...`);
const content = fs.readFileSync(stopsFilePath, 'utf-8');
const lines = content.split('\n').filter(line => line.trim());

if (lines.length < 2) {
    console.error('Error: File appears to be empty or invalid');
    process.exit(1);
}

// Parse header
const header = lines[0].split(',').map(h => h.trim().replace(/\r$/, ''));
const stopIdIdx = header.indexOf('stop_id');
const stopNameIdx = header.indexOf('stop_name');

if (stopIdIdx === -1 || stopNameIdx === -1) {
    console.error('Error: Required columns (stop_id, stop_name) not found');
    console.error('Found columns:', header);
    process.exit(1);
}

// Build lookup map: stop_id -> stop_name
const stops = {};
for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle CSV with potential quoted fields
    const parts = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
    if (!parts || parts.length <= Math.max(stopIdIdx, stopNameIdx)) continue;

    const stopId = parts[stopIdIdx]?.trim().replace(/^"|"$/g, '');
    const stopName = parts[stopNameIdx]?.trim().replace(/^"|"$/g, '');

    if (stopId && stopName) {
        stops[stopId] = stopName;
    }
}

// Ensure output directory exists
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Write as JavaScript module
const jsContent = `// Auto-generated from stops.txt
// Maps stop_id to stop_name for MNR stations
export default ${JSON.stringify(stops, null, 2)};
`;

fs.writeFileSync(outputPath, jsContent, 'utf-8');

console.log(`Written ${Object.keys(stops).length} stops to ${outputPath}`);
console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);
