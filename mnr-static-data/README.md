# MNR Static GTFS Data

MTA MNR Static GTFS Data files from the MTA Developer Resources

## Download Source
https://api.mta.info/#/dataFeeds → Metro-North Railroad

## Files Last Downloaded from api.mta.info
**02/04/2026**

## Files needed from gtfsmnr.zip
- `trips.txt` Trip definitions with headsigns and peak/off-peak info
- `stop_times.txt` Stop times for each trip (used to get start times)
- `stops.txt` Station IDs and names (fallback lookup)

### Updating Static Data 
# remove old txt files
```bash
cd mta-gtfsrt-cloudflare/mnr-static-data
rm trips.txt stop_times.txt stops.txt
```

## Download new GTFS data
Download from https://api.mta.info/#/dataFeeds → Metro-North Railroad

## Extract needed files
Copy `trips.txt`, `stop_times.txt`, and `stops.txt` from the downloaded zip to this folder.

## Regenerate data files
```bash
cd mta-gtfsrt-cloudflare
node scripts/generate-mnr-trips.mjs mnr-static-data/trips.txt mnr-static-data/stop_times.txt # Generate trips lookup
node scripts/generate-mnr-stops.mjs mnr-static-data/stops.txt # Generate stops lookup (station names fallback bc im scared)

# Generate track lookup (predict destination from track)
node scripts/generate-mnr-tracks.mjs

# Upload trips to Cloudflare KV
node scripts/upload-mnr-trips.mjs # Upload trips to Cloudflare KV
```

## Deploy
```bash
npm run deploy
```

## Notes
- May do the same for subway data (so station IDs don't have to be hardcoded on client)
- MNR needs headsigns because trains have different terminals
- MNR has peak/off-peak idicators

