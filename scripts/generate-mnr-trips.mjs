import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const tripsFilePath = process.argv[2];
const stopTimesFilePath = process.argv[3]; // Optional: stop_times.txt for enhanced matching
const outputPath = process.argv[4] || path.join(__dirname, '../src/data/mnr-trips.js');

if (!tripsFilePath) {
  console.error('Usage: node generate-mnr-trips.mjs <trips.txt> [output.json]');
  process.exit(1);
}

if (!fs.existsSync(tripsFilePath)) {
  console.error(`Error: File not found: ${tripsFilePath}`);
  process.exit(1);
}

console.log(`Reading ${tripsFilePath}...`);
const content = fs.readFileSync(tripsFilePath, 'utf-8');
const lines = content.split('\n').filter(line => line.trim());

if (lines.length < 2) {
  console.error('Error: File appears to be empty or invalid');
  process.exit(1);
}

// Parse header (trim whitespace and line endings)
const header = lines[0].split(',').map(h => h.trim().replace(/\r$/, ''));
const tripIdIdx = header.indexOf('trip_id');
const tripHeadsignIdx = header.indexOf('trip_headsign');
const peakOffpeakIdx = header.indexOf('peak_offpeak');

if (tripIdIdx === -1 || tripHeadsignIdx === -1) {
  console.error('Error: Required columns (trip_id, trip_headsign) not found in header');
  console.error('Found columns:', header);
  process.exit(1);
}

// Build lookup map using route_id + start_time (trip_id formats don't match between real-time and static GTFS)
const byRouteTime = {}; // route_id|start_time -> trip_headsign
const routeIdIdx = header.indexOf('route_id');

// Second pass: if stop_times.txt is provided, build route_id + start_time lookup
if (stopTimesFilePath && fs.existsSync(stopTimesFilePath)) {
  console.log(`Reading ${stopTimesFilePath} for enhanced matching...`);
  const stopTimesContent = fs.readFileSync(stopTimesFilePath, 'utf-8');
  const stopTimesLines = stopTimesContent.split('\n').filter(line => line.trim());
  
  if (stopTimesLines.length > 1) {
    const stHeader = stopTimesLines[0].split(',');
    const stTripIdIdx = stHeader.indexOf('trip_id');
    const stDepartureTimeIdx = stHeader.indexOf('departure_time');
    const stStopSequenceIdx = stHeader.indexOf('stop_sequence');
    
    if (stTripIdIdx >= 0 && stDepartureTimeIdx >= 0 && stStopSequenceIdx >= 0) {
      // Find first stop (stop_sequence = 1) for each trip to get start time
      const tripStartTimes = {};
      for (let i = 1; i < stopTimesLines.length; i++) {
        const line = stopTimesLines[i].trim();
        if (!line) continue;
        const parts = line.split(',');
        if (parts.length <= Math.max(stTripIdIdx, stDepartureTimeIdx, stStopSequenceIdx)) continue;
        
        const tripId = parts[stTripIdIdx]?.trim();
        const stopSeq = parts[stStopSequenceIdx]?.trim();
        const depTime = parts[stDepartureTimeIdx]?.trim();
        
        // Get first stop (lowest stop_sequence) for each trip
        if (tripId && depTime && stopSeq) {
          const seq = parseInt(stopSeq, 10);
          if (!tripStartTimes[tripId] || seq < tripStartTimes[tripId].sequence) {
            tripStartTimes[tripId] = { time: depTime, sequence: seq };
          }
        }
      }
      
      // Now match trips with their start times and route_ids
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',');
        if (parts.length <= Math.max(tripIdIdx, tripHeadsignIdx, routeIdIdx, peakOffpeakIdx)) continue;
        
        const tripId = parts[tripIdIdx]?.trim();
        const tripHeadsign = parts[tripHeadsignIdx]?.trim();
        const routeId = routeIdIdx >= 0 ? parts[routeIdIdx]?.trim() : null;
        const startTime = tripStartTimes[tripId]?.time;
        const peakOffpeak = peakOffpeakIdx >= 0 ? parts[peakOffpeakIdx]?.trim() : null;
        
        // Create lookup key: route_id|start_time (date not needed if time is unique enough)
        if (routeId && startTime && tripHeadsign) {
          // Note: We'd need start_date too, but that's in calendar_dates.txt
          // For now, use route_id + start_time as key
          const key = `${routeId}|${startTime}`;
          // If multiple trips have same route+time, keep the first one
          if (!byRouteTime[key]) {
            byRouteTime[key] = {
              headsign: tripHeadsign,
              peak_offpeak: peakOffpeak || null
            };
          }
        }
      }
      console.log(`Created ${Object.keys(byRouteTime).length} route+time mappings`);
    }
  }
}

// Ensure output directory exists
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Determine output format based on file extension
const isJS = outputPath.endsWith('.js');
const isJSON = outputPath.endsWith('.json');

const outputData = {
  byRouteTime: Object.keys(byRouteTime).length > 0 ? byRouteTime : {}
};

if (isJS) {
  // Write as JavaScript module for better compatibility
  const jsContent = `// Auto-generated from trips.txt and stop_times.txt
// Maps route_id|start_time to trip_headsign (direction name)
// Note: Real-time trip_ids don't match static GTFS format, so we match by route + time instead
export default ${JSON.stringify(outputData, null, 2)};`;
  fs.writeFileSync(outputPath, jsContent, 'utf-8');
} else {
  // Write JSON file
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
}

console.log(`Written ${Object.keys(byRouteTime).length} route+time mappings to ${outputPath}`);
console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);

