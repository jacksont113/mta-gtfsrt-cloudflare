# MNR Static GTFS Data

MTA MNR Static GTFS Data files from the MTA Developer Resources

## Download Source
https://api.mta.info/#/dataFeeds → Metro-North Railroad

## Last Updated
**February 2026**

## Files
| File | Purpose |
|------|---------|
| `trips.txt` | Trip definitions with headsigns and peak/off-peak info |
| `stop_times.txt` | Stop times for each trip (used to get start times) |
| `stops.txt` | Station IDs and names (fallback lookup) |

## Updating Static Data

### 1. Remove old files
```bash
cd mta-gtfsrt-cloudflare/mnr-static-data
rm trips.txt stop_times.txt stops.txt
```

### 2. Download new GTFS data
Download from https://api.mta.info/#/dataFeeds → Metro-North Railroad

### 3. Extract needed files
Copy `trips.txt`, `stop_times.txt`, and `stops.txt` from the downloaded zip to this folder.

### 4. Regenerate data files
```bash
cd mta-gtfsrt-cloudflare

# Generate trips lookup (headsigns, peak/off-peak)
node scripts/generate-mnr-trips.mjs mnr-static-data/trips.txt mnr-static-data/stop_times.txt

# Generate stops lookup (station names fallback)
node scripts/generate-mnr-stops.mjs mnr-static-data/stops.txt

# Upload trips to Cloudflare KV
node scripts/upload-mnr-trips.mjs
```

### 5. Deploy
```bash
npm run deploy
```

## Notes
- May do the same for subway data (so station IDs don't have to be hardcoded on client)
- MNR needs headsigns because trains have different terminals
- MNR has peak/off-peak pricing

