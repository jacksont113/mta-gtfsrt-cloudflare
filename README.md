# MTA GTFS-Realtime → JSON (Cloudflare Worker)

Cloudflare Worker that fetches MTA GTFS-RT protobuf feeds and returns JSON. Made for ESP32 and other devices that struggle with parsing big protobufs.

## Feeds
- Subway (IRT, ACE, BDFM, NQRW, JZ, L, G, SI)
- Metro-North (with direction/peak-offpeak info)
- Alerts (subway, bus, lirr, mnr)

## Run
```bash
npm install
npm run dev      # local
npm run deploy   # cloudflare
```

## Endpoints
- `/v1/feeds` - list feeds
- `/v1/feed/:feed/arrivals?stop_id=123N` - next arrivals 
- `/v1/feed/:feed/raw` - full decoded gtfs-rt
- `/v1/alerts/:scope` - alerts (subway/bus/lirr/mnr)

## MNR Static Data
Metro-North needs static gtfs data for direction names and peak/offpeak. See `mnr-static-data/README.md` to update.

## Notes
- MTA feeds are public (no api key needed for most)
- Uses cloudflare edge caching (10-30s) so we dont decode every request
- subway `stop_id` has direction suffix like `123N` or `123S`
- mnr uses numeric stop_id (like `86` for Katonah) and direction is returned as headsign name (like "Grand Central")
