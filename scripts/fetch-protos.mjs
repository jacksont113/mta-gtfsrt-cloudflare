import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const PROTOS = [
  {
    name: "com/google/transit/realtime/gtfs-realtime.proto",
    url: "https://raw.githubusercontent.com/google/transit/master/gtfs-realtime/proto/gtfs-realtime.proto"
  },
  {
    name: "gtfs-realtime-NYCT.proto",
    url: "https://raw.githubusercontent.com/OneBusAway/onebusaway-gtfs-realtime-api/master/src/main/proto/com/google/transit/realtime/gtfs-realtime-NYCT.proto"
  },
  {
    name: "gtfs-realtime-service-status.proto",
    url: "https://raw.githubusercontent.com/OneBusAway/onebusaway-gtfs-realtime-api/master/src/main/proto/com/google/transit/realtime/gtfs-realtime-service-status.proto"
  }
];

async function main() {
  const outDir = "protos";
  await mkdir(outDir, { recursive: true });

  for (const p of PROTOS) {
    const res = await fetch(p.url);
    if (!res.ok) throw new Error(`Failed ${p.url}: ${res.status} ${res.statusText}`);
    const text = await res.text();
    const outPath = `${outDir}/${p.name}`;
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, text, "utf8");
    console.log(`Wrote ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
