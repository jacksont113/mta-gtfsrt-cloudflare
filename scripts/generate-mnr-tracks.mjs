
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, '..', 'mnr-static-data');
const OUT_FILE = path.join(__dirname, '..', 'src', 'data', 'mnr-tracks.js');

function parseCSV(content, rowHandler) {
    const lines = content.split('\n');
    if (lines.length < 2) return;
    const headers = lines[0].trim().split(',');

    const headerMap = {};
    headers.forEach((h, i) => headerMap[h] = i);

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = line.split(',');
        rowHandler(values, headerMap);
    }
}

// Map trip_id -> headsign
console.log("Reading trips.txt...");
const trips = fs.readFileSync(path.join(STATIC_DIR, 'trips.txt'), 'utf8');
const tripHeadsigns = {};

parseCSV(trips, (row, map) => {
    const tid = row[map['trip_id']];
    const sign = row[map['trip_headsign']];
    if (tid && sign) tripHeadsigns[tid] = sign;
});

// Map stop_id -> track -> headsign -> count
console.log("Reading stop_times.txt...");
const times = fs.readFileSync(path.join(STATIC_DIR, 'stop_times.txt'), 'utf8');
const stats = {};

parseCSV(times, (row, map) => {
    const tid = row[map['trip_id']];
    const sid = row[map['stop_id']];
    const track = row[map['track']]?.replace(/"/g, '');

    if (!tid || !sid || !track || track === '0') return;

    const sign = tripHeadsigns[tid];
    if (!sign) return;

    if (!stats[sid]) stats[sid] = {};
    if (!stats[sid][track]) stats[sid][track] = {};

    stats[sid][track][sign] = (stats[sid][track][sign] || 0) + 1;
});

// Find most frequent destination per track
const finalMap = {};
// Stop 4 (Harlem-125 St) is a major hub where tracks serve many branches. 
// Guessing based on "most frequent" is dangerous here.
const EXCLUDED_STOPS = new Set(['4']);

Object.keys(stats).forEach(sid => {
    if (EXCLUDED_STOPS.has(sid)) return;

    Object.keys(stats[sid]).forEach(trk => {
        const signs = stats[sid][trk];
        const winner = Object.keys(signs).reduce((a, b) => signs[a] > signs[b] ? a : b);

        if (!finalMap[sid]) finalMap[sid] = {};
        finalMap[sid][trk] = winner;
    });
});

console.log(`Generated tracks for ${Object.keys(finalMap).length} stops.`);

const output = `// Auto-generated from static GTFS (stop_times.txt + trips.txt)
// Maps StopID -> Track -> Destination
// Generated: ${new Date().toISOString()}

export const MNR_TRACKS = ${JSON.stringify(finalMap, null, 2)};
`;

fs.writeFileSync(OUT_FILE, output);
console.log(`Wrote to ${OUT_FILE}`);
