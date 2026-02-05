import * as nyctMod from "./src/generated/gtfsrt_nyct.js";
import * as mercuryMod from "./src/generated/gtfsrt_mercury.js";
import { MNR_STOPS } from "./src/data/mnr-stops.js";
import { MNR_TRACKS } from "./src/data/mnr-tracks.js";

const FEEDS = {
  irt: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs",
  ace: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
  bdfm: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
  nqrw: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  jz: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
  l: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
  g: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
  si: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si",
  mnr: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr"
};

const ALERT_FEEDS = {
  subway: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts",
  all: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts",
  bus: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fbus-alerts",
  lirr: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Flirr-alerts",
  mnr: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fmnr-alerts"
};


function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...headers
    }
  });
}

function notFound() {
  return json({ ok: false, error: "Not found" }, 404);
}

function bad(msg) {
  return json({ ok: false, error: msg }, 400);
}

async function fetchPb(url, cacheSeconds, apiKey) {
  const headers = {
    accept: "application/x-protobuf, application/octet-stream;q=0.9, */*;q=0.1",
    "accept-encoding": "identity"
  };

  // if (apiKey) headers["x-api-key"] = apiKey;

  const req = new Request(url, { headers });

  const cache = caches.default;
  const cacheKey = new Request(req.url, req);

  const hit = await cache.match(cacheKey);
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const res = await fetch(req);
  if (!res.ok) throw new Error(`Upstream ${res.status} ${res.statusText}`);

  const ab = await res.arrayBuffer();

  await cache.put(
    cacheKey,
    new Response(ab, {
      headers: {
        "cache-control": `public, max-age=${cacheSeconds}`,
        "content-type": "application/x-protobuf"
      }
    })
  );

  return new Uint8Array(ab);
}

// Second-layer cache
async function fetchAndDecodeWithCache(feedUrl, FeedMessage, cacheSeconds) {
  const cache = caches.default;
  const jsonCacheKey = new Request(feedUrl + "?format=decoded-json");

  const hit = await cache.match(jsonCacheKey);
  if (hit) return await hit.json();

  const bytes = await fetchPb(feedUrl, cacheSeconds);
  const msg = FeedMessage.decode(bytes);
  const decoded = toObj(FeedMessage, msg);

  await cache.put(
    jsonCacheKey,
    new Response(JSON.stringify(decoded), {
      headers: {
        "cache-control": `public, max-age=${cacheSeconds}`,
        "content-type": "application/json"
      }
    })
  );

  return decoded;
}

// arrivals
async function fetchArrivalsOptimized(feedUrl, FeedMessage, cacheSeconds, stopId, limit, tripsLookup, feedKey) {
  const cache = caches.default;
  const arrivalsCacheKey = new Request(feedUrl + `?format=arrivals-v2&stop_id=${stopId}&limit=${limit}`);

  // check arrival cache
  const hit = await cache.match(arrivalsCacheKey);
  if (hit) {
    return { cached: true, response: hit };
  }

  // fetch protobuf
  const bytes = await fetchPb(feedUrl, cacheSeconds);

  // Decode protobuf
  const msg = FeedMessage.decode(bytes);

  const tNow = nowUnix();
  const out = [];

  const getStopName = (sid) => {
    if (!sid) return null;
    const cleanId = sid.endsWith('N') || sid.endsWith('S') ? sid.slice(0, -1) : sid;
    return MNR_STOPS[cleanId] || MNR_STOPS[sid] || null;
  };

  const dirFromStopId = (sid) => {
    if (typeof sid !== "string" || sid.length === 0) return null;
    const last = sid[sid.length - 1].toUpperCase();
    if (last === "N") return "NORTH";
    if (last === "S") return "SOUTH";
    return null;
  };

  const dirFromDirectionId = (id) => {
    if (id === 0) return "DIR_0";
    if (id === 1) return "DIR_1";
    return null;
  };

  const dirFromTripsLookup = (lookup, routeId, startTime) => {
    if (!lookup || !routeId || !startTime) return null;
    const key = `${routeId}|${startTime}`;
    const match = lookup[key];
    return match?.headsign ?? (typeof match === 'string' ? match : null);
  };

  const peakOffpeakFromTripsLookup = (lookup, routeId, startTime) => {
    if (!lookup || !routeId || !startTime) return null;
    const key = `${routeId}|${startTime}`;
    const match = lookup[key];
    return match?.peak_offpeak ?? null;
  };

  // Station-specific fallbacks for direction based on track assignment
  const dirFromTrackAtStop = (stopId, track) => {
    if (!stopId || !track) return null;

    // Generated from static GTFS data (stops.txt + stop_times.txt + trips.txt)
    return MNR_TRACKS[stopId]?.[track] || null;
  };

  // Work directly with the raw decoded message - entity array
  const entities = msg.entity || [];

  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    const tu = ent.tripUpdate;
    if (!tu) continue;

    const trip = tu.trip || {};
    const route_id = trip.routeId || null;
    const trip_id = trip.tripId || null;
    const direction_id = trip.directionId ?? null;
    const start_time = trip.startTime || null;

    // Access NYCT extension directly from raw message (try camelCase property first)
    const nyctTrip = trip.nyctTripDescriptor || trip.nyct_trip_descriptor || null;
    const train_id = nyctTrip?.trainId || nyctTrip?.train_id || null;
    const peak_offpeak = peakOffpeakFromTripsLookup(tripsLookup, route_id, start_time);

    const stus = tu.stopTimeUpdate || [];

    for (let j = 0; j < stus.length; j++) {
      const stu = stus[j];
      const sid = stu.stopId;
      if (sid !== stopId) continue;

      const arr = stu.arrival?.time != null ? Number(stu.arrival.time) : null;
      const dep = stu.departure?.time != null ? Number(stu.departure.time) : null;
      const when = arr ?? dep;

      if (!when || !Number.isFinite(when)) continue;
      if (when < tNow - 60) continue;

      // Access extensions directly (try camelCase property first)
      const nyctStopTime = stu.nyctStopTimeUpdate || stu.nyct_stop_time_update || null;
      const railroadStopTime = stu.mtaRailroadStopTimeUpdate || stu.mta_railroad_stop_time_update || null;

      const scheduled_track = nyctStopTime?.scheduledTrack || nyctStopTime?.scheduled_track || null;
      const actual_track = nyctStopTime?.actualTrack || nyctStopTime?.actual_track || railroadStopTime?.track || null;
      const train_status = railroadStopTime?.trainStatus || railroadStopTime?.train_status || null;

      // Terminal determination
      const lastStu = stus.length > 0 ? stus[stus.length - 1] : null;
      const terminalStopId = lastStu?.stopId;
      const terminalName = getStopName(terminalStopId);

      const direction =
        dirFromTripsLookup(tripsLookup, route_id, start_time) ??
        terminalName ??
        nyctTrip?.direction ??
        dirFromTrackAtStop(stopId, actual_track) ??
        dirFromStopId(stopId) ??
        dirFromDirectionId(direction_id) ??
        null;

      const arrival = {
        when,
        minutes: Math.round((when - tNow) / 60),
        route_id,
        trip_id,
        arrival_time: arr,
        departure_time: dep
      };

      if (direction != null) arrival.direction = direction;
      if (direction_id != null) arrival.direction_id = direction_id;
      if (train_id != null) arrival.train_id = train_id;
      if (scheduled_track != null) arrival.scheduled_track = scheduled_track;
      if (actual_track != null) arrival.actual_track = actual_track;
      if (train_status != null) arrival.train_status = train_status;
      if (peak_offpeak != null) arrival.peak_offpeak = peak_offpeak;

      out.push(arrival);
    }
  }

  out.sort((a, b) => a.when - b.when);
  const arrivals = out.slice(0, limit);

  const responseData = { ok: true, feed: feedKey, stop_id: stopId, now: tNow, arrivals };

  // Cache the result
  await cache.put(
    arrivalsCacheKey,
    new Response(JSON.stringify(responseData), {
      headers: {
        "cache-control": `public, max-age=15`,
        "content-type": "application/json"
      }
    })
  );

  return { cached: false, data: responseData };
}

// final JSON (summary/arrivals) cache
async function fetchAndProcessWithCache(feedUrl, FeedMessage, cacheSeconds, processFn) {
  const cache = caches.default;
  const processedCacheKey = new Request(feedUrl + "?format=processed-json&fn=" + (processFn.name || "anon"));

  const hit = await cache.match(processedCacheKey);
  if (hit) return await hit.json();

  // fetch and decode protobuf
  const decoded = await fetchAndDecodeWithCache(feedUrl, FeedMessage, cacheSeconds);
  const processed = processFn(decoded);

  await cache.put(
    processedCacheKey,
    new Response(JSON.stringify(processed), {
      headers: {
        "cache-control": `public, max-age=${cacheSeconds}`,
        "content-type": "application/json"
      }
    })
  );

  return processed;
}

function getTransitRealtime(mod) {
  return (
    mod?.transit_realtime ??
    mod?.$root?.transit_realtime ??
    mod?.default?.transit_realtime ??
    mod?.default?.$root?.transit_realtime
  );
}

function toObj(FeedMessage, msg) {
  if (typeof FeedMessage?.toObject === "function") {
    return FeedMessage.toObject(msg, {
      longs: Number, // Changed from String to Number
      enums: String,
      bytes: String,
      defaults: false,
      arrays: true,
      objects: true,
      oneofs: true,
      json: true
    });
  }
  return msg;
}

function collectStops(feedObj) {
  const set = new Set();
  for (const ent of feedObj?.entity ?? []) {
    const tu = ent?.tripUpdate ?? ent?.trip_update;
    if (!tu) continue;
    for (const stu of tu.stopTimeUpdate ?? tu.stop_time_update ?? []) {
      const sid = stu?.stopId ?? stu?.stop_id;
      if (sid) set.add(sid);
    }
  }
  return [...set].sort();
}

function computeArrivals(feedObj, stopId, limit, tripsLookup = null) {
  const tNow = nowUnix();
  const out = [];

  const getStopName = (sid) => {
    if (!sid) return null;
    const cleanId = sid.endsWith('N') || sid.endsWith('S') ? sid.slice(0, -1) : sid;
    return MNR_STOPS[cleanId] || MNR_STOPS[sid] || null;
  };

  // Some trip updates lack the mta direction extension; fall back to stop suffix when possible.
  const dirFromStopId = (sid) => {
    if (typeof sid !== "string" || sid.length === 0) return null;
    const last = sid[sid.length - 1].toUpperCase();
    if (last === "N") return "NORTH";
    if (last === "S") return "SOUTH";
    return null;
  };
  const dirFromDirectionId = (id) => {
    if (id === 0) return "DIR_0";
    if (id === 1) return "DIR_1";
    return null;
  };
  const dirFromTripsLookup = (lookup, routeId, startTime) => {
    if (!lookup || !routeId || !startTime) return null;

    // match by route_id + start_time
    const key = `${routeId}|${startTime}`;
    const match = lookup[key];
    return match?.headsign ?? (typeof match === 'string' ? match : null);
  };

  const peakOffpeakFromTripsLookup = (lookup, routeId, startTime) => {
    if (!lookup || !routeId || !startTime) return null;

    const key = `${routeId}|${startTime}`;
    const match = lookup[key];
    return match?.peak_offpeak ?? null;
  };

  // Station-specific fallbacks for direction based on track assignment
  const dirFromTrackAtStop = (stopId, track) => {
    if (!stopId || !track) return null;

    // Generated from static GTFS data (stops.txt + stop_times.txt + trips.txt)
    return MNR_TRACKS[stopId]?.[track] || null;
  };

  for (const ent of feedObj?.entity ?? []) {
    const tu = ent?.tripUpdate ?? ent?.trip_update;
    if (!tu) continue;

    const trip = tu.trip ?? {};
    const route_id = trip.routeId ?? trip.route_id ?? null;
    const trip_id = trip.tripId ?? trip.trip_id ?? null;
    const direction_id = trip.directionId ?? trip.direction_id ?? null;
    const start_time = trip.startTime ?? trip.start_time ?? null;

    const nyctTrip =
      trip[".transit_realtime.nyct_trip_descriptor"] ??
      trip[".com.google.transit.realtime.nyct_trip_descriptor"] ??
      null;

    const train_id = nyctTrip?.train_id ?? nyctTrip?.trainId ?? null;
    const peak_offpeak = peakOffpeakFromTripsLookup(tripsLookup, route_id, start_time);

    for (const stu of tu.stopTimeUpdate ?? tu.stop_time_update ?? []) {
      const sid = stu.stopId ?? stu.stop_id;
      if (sid !== stopId) continue;

      const arrT = stu.arrival?.time ?? null;
      const depT = stu.departure?.time ?? null;

      const arr = arrT != null ? Number(arrT) : null;
      const dep = depT != null ? Number(depT) : null;
      const when = arr ?? dep;

      if (!when || !Number.isFinite(when)) continue;
      if (when < tNow - 60) continue;

      const nyctStopTime =
        stu[".transit_realtime.nyct_stop_time_update"] ??
        stu[".com.google.transit.realtime.nyct_stop_time_update"] ??
        null;
      const railroadStopTime =
        stu[".transit_realtime.mta_railroad_stop_time_update"] ??
        stu[".com.google.transit.realtime.mta_railroad_stop_time_update"] ??
        stu[".transit_realtime.mtaRailroadStopTimeUpdate"] ??
        stu[".com.google.transit.realtime.mtaRailroadStopTimeUpdate"] ??
        null;

      const scheduled_track = nyctStopTime?.scheduled_track ?? null;
      const actual_track = nyctStopTime?.actual_track ?? railroadStopTime?.track ?? null;
      const train_status = railroadStopTime?.trainStatus ?? railroadStopTime?.train_status ?? null;

      // determine terminal stop (eg grand central)
      const stus = tu.stopTimeUpdate ?? tu.stop_time_update ?? [];
      const lastStu = stus.length > 0 ? stus[stus.length - 1] : null;
      const terminalStopId = lastStu?.stopId ?? lastStu?.stop_id;
      const terminalName = getStopName(terminalStopId);

      // determine direction
      const direction =
        dirFromTripsLookup(tripsLookup, route_id, start_time) ??
        terminalName ??
        nyctTrip?.direction ??
        dirFromTrackAtStop(stopId, actual_track) ??
        dirFromStopId(stopId) ??
        dirFromDirectionId(direction_id) ??
        null;

      const arrival = {
        when,
        minutes: Math.round((when - tNow) / 60),
        route_id,
        trip_id,
        arrival_time: arr,
        departure_time: dep
      };

      // exclude null fields
      if (direction != null) arrival.direction = direction;
      if (direction_id != null) arrival.direction_id = direction_id;
      if (train_id != null) arrival.train_id = train_id;
      if (scheduled_track != null) arrival.scheduled_track = scheduled_track;
      if (actual_track != null) arrival.actual_track = actual_track;
      if (train_status != null) arrival.train_status = train_status;
      if (peak_offpeak != null) arrival.peak_offpeak = peak_offpeak;

      out.push(arrival);
    }
  }

  out.sort((a, b) => a.when - b.when);
  return out.slice(0, limit);
}

function firstText(txt) {
  const trans = txt?.translation ?? [];
  for (const t of trans) {
    const s = t?.text;
    if (typeof s === "string" && s.trim()) return s.trim();
  }
  return "";
}

function summarizeAlerts(alertFeed) {
  const out = [];

  for (const ent of alertFeed?.entity ?? []) {
    const a = ent?.alert;
    if (!a) continue;

    const id = ent.id ?? "";
    const kind =
      id.startsWith("lmm:planned_work:") ? "planned_work" :
        id.startsWith("lmm:alert:") ? "alert" :
          "unknown";

    const periods = (a.active_period ?? a.activePeriod ?? []).map((p) => ({
      start: p.start != null ? Number(p.start) : null,
      end: p.end != null ? Number(p.end) : null
    }));

    const active_now = periods.length
      ? periods.some((p) => {
        const s = p.start ?? 0;
        const e = p.end ?? 0;
        const t = nowUnix();
        if (s && t < s) return false;
        if (e && t > e) return false;
        return true;
      })
      : null;

    const header = firstText(a.header_text ?? a.headerText);
    const description = firstText(a.description_text ?? a.descriptionText);

    const mercury =
      a[".transit_realtime.mercury_alert"] ??
      a[".com.google.transit.realtime.mercury_alert"] ??
      null;

    out.push({
      id,
      kind,
      active_now,
      active_period: periods,
      header,
      description,
      informed_entity: a.informed_entity ?? a.informedEntity ?? [],
      mercury
    });
  }

  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,OPTIONS",
          "access-control-allow-headers": "*"
        }
      });
    }

    if (request.method !== "GET") {
      return json({ ok: false, error: "Method not allowed" }, 405, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "*"
      });
    }

    // GET /
    if (parts.length === 0) {
      return json({
        ok: true,
        service: "mta-gtfsrt-json",
        routes: {
          feeds: "/v1/feeds",
          feed_raw: "/v1/feed/:feed/raw",
          feed_arrivals: "/v1/feed/:feed/arrivals?stop_id=123N&limit=8",
          feed_stops: "/v1/feed/:feed/stops",
          alerts_raw: "/v1/alerts/:scope/raw (scope=subway|all|bus|lirr|mnr)",
          alerts_summary: "/v1/alerts/:scope (scope=subway|all|bus|lirr|mnr)"
        }
      });
    }

    // GET /v1/feeds
    if (parts[0] === "v1" && parts[1] === "feeds") {
      return json({ ok: true, feeds: Object.keys(FEEDS), alert_feeds: Object.keys(ALERT_FEEDS) });
    }

    // GET /v1/feed/:feed/raw
    if (parts[0] === "v1" && parts[1] === "feed" && parts[3] === "raw") {
      const nyctTR = getTransitRealtime(nyctMod);
      const feedKey = parts[2];
      const feedUrl = FEEDS[feedKey];
      if (!feedUrl) return bad(`Unknown feed '${feedKey}'. Try /v1/feeds`);

      try {
        const decoded = await fetchAndDecodeWithCache(feedUrl, nyctTR.FeedMessage, 20, env.MTA_API_KEY);
        return json({ ok: true, feed: feedKey, header: decoded.header, entity: decoded.entity });
      } catch (e) {
        return json({ ok: false, error: String(e?.message ?? e) }, 502);
      }
    }

    // GET /v1/feed/:feed/stops
    if (parts[0] === "v1" && parts[1] === "feed" && parts[3] === "stops") {
      const nyctTR = getTransitRealtime(nyctMod);
      const feedKey = parts[2];
      const feedUrl = FEEDS[feedKey];
      if (!feedUrl) return bad(`Unknown feed '${feedKey}'. Try /v1/feeds`);

      try {
        const decoded = await fetchAndDecodeWithCache(feedUrl, nyctTR.FeedMessage, 20, env.MTA_API_KEY);
        return json({ ok: true, feed: feedKey, stops: collectStops(decoded) });
      } catch (e) {
        return json({ ok: false, error: String(e?.message ?? e) }, 502);
      }
    }

    // GET /v1/feed/:feed/arrivals?stop_id=...&limit=...
    if (parts[0] === "v1" && parts[1] === "feed" && parts[3] === "arrivals") {
      const nyctTR = getTransitRealtime(nyctMod);
      const feedKey = parts[2];
      const feedUrl = FEEDS[feedKey];
      if (!feedUrl) return bad(`Unknown feed '${feedKey}'. Try /v1/feeds`);

      const stopId = url.searchParams.get("stop_id");
      if (!stopId) return bad("Missing stop_id (example: stop_id=123N)");

      const limitRaw = Number(url.searchParams.get("limit") ?? "8");
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.trunc(limitRaw))) : 8;

      try {
        // Use trips lookup for MNR feed to get direction names from trip_headsign (loaded from KV)
        const tripsLookup = feedKey === "mnr" ? await env.MNR_TRIPS?.get("trips", { type: "json" }) : null;

        const result = await fetchArrivalsOptimized(
          feedUrl,
          nyctTR.FeedMessage,
          20, // Cache raw PBs for 20s
          env.MTA_API_KEY,
          stopId,
          limit,
          tripsLookup,
          feedKey
        );

        if (result.cached) return result.response;
        return json(result.data);
      } catch (e) {
        return json({ ok: false, error: String(e?.message ?? e) }, 502);
      }
    }

    // GET /v1/alerts/:scope/raw
    if (parts[0] === "v1" && parts[1] === "alerts" && parts[3] === "raw" && parts.length === 4) {
      const mercuryTR = getTransitRealtime(mercuryMod);
      const scope = parts[2];
      const feedUrl = ALERT_FEEDS[scope];
      if (!feedUrl) return bad(`Unknown alerts scope '${scope}'. Try /v1/feeds`);

      try {
        const decoded = await fetchAndDecodeWithCache(feedUrl, mercuryTR.FeedMessage, 30, env.MTA_API_KEY);
        return json({ ok: true, scope, header: decoded.header, entity: decoded.entity });
      } catch (e) {
        return json({ ok: false, error: String(e?.message ?? e) }, 502);
      }
    }

    // GET /v1/alerts/:scope
    if (parts[0] === "v1" && parts[1] === "alerts" && parts.length === 3) {
      const mercuryTR = getTransitRealtime(mercuryMod);
      const scope = parts[2];
      const feedUrl = ALERT_FEEDS[scope];
      if (!feedUrl) return bad(`Unknown alerts scope '${scope}'. Try /v1/feeds`);

      try {
        // Use the new summary caching to avoid re-processing huge alert feeds
        const alerts = await fetchAndProcessWithCache(
          feedUrl,
          mercuryTR.FeedMessage,
          30,
          summarizeAlerts
        );
        return json({ ok: true, scope, now: nowUnix(), alerts });
      } catch (e) {
        return json({ ok: false, error: String(e?.message ?? e) }, 502);
      }
    }

    return notFound();
  },

  async scheduled(event, env, ctx) {
    // Warmer disabled by user request
    // caches feeds
    // const feedPromises = Object.values(FEEDS).map(url =>
    //   fetchPb(url, 20, env.MTA_API_KEY).catch(err => console.error("Warm feed failed", url, err))
    // );

    // caches alerts
    // const mercuryTR = getTransitRealtime(mercuryMod);
    // // caches alerts (limit to essential to avoid hitting 50 subrequest limit)
    // // 9 feeds * 3 ops = 27. 2 alerts * 7 ops = 14. Total 41 < 50.
    // const ESSENTIAL_ALERTS = ['subway', 'mnr'];
    // const alertPromises = ESSENTIAL_ALERTS.map(key => {
    //   const url = ALERT_FEEDS[key];
    //   return fetchAndProcessWithCache(url, mercuryTR.FeedMessage, 30, summarizeAlerts)
    //     .catch(err => console.error("Warm alert failed", url, err));
    // });

    // ctx.waitUntil(Promise.all([...feedPromises, ...alertPromises]));
  }
};
