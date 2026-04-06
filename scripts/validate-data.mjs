import { readFile, stat } from 'node:fs/promises'

const pokelids = JSON.parse(
  await readFile(new URL('../public/data/pokelids.json', import.meta.url), 'utf8'),
)
const transit = JSON.parse(
  await readFile(new URL('../public/data/transit-index.json', import.meta.url), 'utf8'),
)
const pmtilesInfo = await stat(new URL('../public/data/transit.pmtiles', import.meta.url))

if (pokelids.length <= 400) {
  throw new Error(`Expected more than 400 Poké Lids, got ${pokelids.length}`)
}

for (const lid of pokelids) {
  if (!Number.isFinite(lid.lat) || !Number.isFinite(lid.lng)) {
    throw new Error(`Invalid coordinates for lid ${lid.manholeNo}`)
  }
}

if (!Array.isArray(transit.trainStations) || !Array.isArray(transit.busStops)) {
  throw new Error('Transit index is missing required arrays')
}

if (pmtilesInfo.size <= 0) {
  throw new Error('transit.pmtiles was not generated')
}

console.log(
  `Validated ${pokelids.length} lids, ${transit.stats.totalTransitPoints} transit points, and transit.pmtiles (${pmtilesInfo.size} bytes).`,
)
