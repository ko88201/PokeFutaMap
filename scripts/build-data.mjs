import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import osmtogeojson from 'osmtogeojson'

const execFileAsync = promisify(execFile)
const PUBLIC_DATA_DIR = new URL('../public/data/', import.meta.url)
const CACHE_DIR = new URL('../.cache/', import.meta.url)
const TOOL_CACHE_DIR = new URL('../.cache/tools/', import.meta.url)
await mkdir(PUBLIC_DATA_DIR, { recursive: true })
await mkdir(CACHE_DIR, { recursive: true })
await mkdir(TOOL_CACHE_DIR, { recursive: true })

const pokelids = await syncPokeLids()
await syncTransit(pokelids)

async function syncPokeLids() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('')
  const responses = await Promise.all(
    alphabet.map(async (keyword) => {
      const response = await fetch(
        `https://local.pokemon.jp/en/manhole/search/?keyword=${keyword}`,
      )
      if (!response.ok) {
        throw new Error(`Failed to fetch search results for ${keyword}`)
      }

      const payload = await response.json()
      return payload.list
    }),
  )

  const uniqueItems = new Map()
  for (const batch of responses) {
    for (const item of batch) {
      uniqueItems.set(String(item.manhole_no), item)
    }
  }

  const japaneseTitles = new Map(
    await Promise.all(
      [...uniqueItems.keys()].map(async (manholeNo) => [
        manholeNo,
        await fetchJapaneseLidTitle(manholeNo),
      ]),
    ),
  )

  const lids = [...uniqueItems.values()]
    .map((item) => ({
      area: item.area || '',
      googleMapsUrl: `https://maps.google.com/?q=${item.lat},${item.lng}`,
      imageUrl: new URL(item.picture.url_l, 'https://local.pokemon.jp').toString(),
      isNew: Boolean(item.is_new),
      lat: Number(item.lat),
      lng: Number(item.lng),
      manholeNo: String(item.manhole_no),
      name:
        japaneseTitles.get(String(item.manhole_no)) ||
        item.name ||
        `ポケふた ${item.manhole_no}`,
      pokemon: item.pokemon_list.map((pokemon) => pokemon.name),
      prefName: item.pref_name,
      prefSlug: item.pref_en_name,
      publishStartDate: item.publish_start_date ?? '',
      searchKeywords: item.search_keyword ?? '',
      sourceUrl: `https://local.pokemon.jp/manhole/desc/${item.manhole_no}/`,
    }))
    .filter((lid) => Number.isFinite(lid.lat) && Number.isFinite(lid.lng))
    .sort((left, right) => Number(left.manholeNo) - Number(right.manholeNo))

  await writeJson('pokelids.json', lids)
  return lids
}

async function fetchJapaneseLidTitle(manholeNo) {
  try {
    const response = await fetch(
      `https://local.pokemon.jp/manhole/desc/${manholeNo}/?is_modal=1`,
    )
    if (!response.ok) {
      return ''
    }

    const html = await response.text()
    const headingMatch = html.match(/<h1>([^<]+)<\/h1>/)
    return headingMatch?.[1]?.trim() ?? ''
  } catch {
    return ''
  }
}

async function syncTransit(pokelids) {
  const targets = buildTransitTargets(pokelids)
  const collectedFeatures = []

  for (const target of targets) {
    const cacheDir = new URL('./overpass/', CACHE_DIR)
    await mkdir(cacheDir, { recursive: true })
    const cacheFile = new URL(`./${target.id}.json`, cacheDir)

    let raw
    if (await isFileFresh(cacheFile, 1000 * 60 * 60 * 24 * 7)) {
      raw = JSON.parse(await readFile(cacheFile, 'utf8'))
    } else {
      try {
        raw = await fetchTransitPayload(target)
      } catch (error) {
        console.warn(
          `Skipping transit target ${target.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        )
        raw = { elements: [], version: 0.6 }
      }
      await writeFile(cacheFile, JSON.stringify(raw))
    }

    const geojson = osmtogeojson(raw)
    for (const feature of geojson.features) {
      const normalized = normalizeTransitFeature(feature, target.prefName)
      if (normalized) {
        collectedFeatures.push(normalized)
      }
    }
  }

  const deduped = dedupeFeatures(collectedFeatures)
  const railRoutes = deduped.filter((feature) => feature.properties.kind === 'rail_route')
  const trainStations = deduped.filter((feature) => feature.properties.kind === 'train_station')
  const busStops = deduped.filter((feature) => feature.properties.kind === 'bus_stop')
  const busStations = deduped.filter((feature) => feature.properties.kind === 'bus_station')

  await writeJson('transit-index.json', {
    busStations: busStations.map(toPointRecord),
    busStops: busStops.map(toPointRecord),
    railRoutes: railRoutes.map(toRouteRecord),
    stats: {
      totalRailRoutes: railRoutes.length,
      totalTransitPoints: trainStations.length + busStops.length + busStations.length,
    },
    trainStations: trainStations.map(toPointRecord),
  })

  const sourceDir = new URL('./transit/', CACHE_DIR)
  await rm(sourceDir, { recursive: true, force: true })
  await mkdir(sourceDir, { recursive: true })

  await writeFile(
    new URL('./rail-routes.geojson', sourceDir),
    JSON.stringify({ type: 'FeatureCollection', features: railRoutes }),
  )
  await writeFile(
    new URL('./train-stations.geojson', sourceDir),
    JSON.stringify({ type: 'FeatureCollection', features: trainStations }),
  )
  await writeFile(
    new URL('./bus-stops.geojson', sourceDir),
    JSON.stringify({ type: 'FeatureCollection', features: busStops }),
  )
  await writeFile(
    new URL('./bus-stations.geojson', sourceDir),
    JSON.stringify({ type: 'FeatureCollection', features: busStations }),
  )

  const mbtilesPath = filePathFromUrl(new URL('./transit.mbtiles', sourceDir))
  const pmtilesPath = filePathFromUrl(new URL('./transit.pmtiles', PUBLIC_DATA_DIR))

  await execFileAsync('tippecanoe', [
    '-o',
    mbtilesPath,
    '--force',
    '--drop-densest-as-needed',
    '--extend-zooms-if-still-dropping',
    '-zg',
    '-L',
    `rail_routes:${filePathFromUrl(new URL('./rail-routes.geojson', sourceDir))}`,
    '-L',
    `train_stations:${filePathFromUrl(new URL('./train-stations.geojson', sourceDir))}`,
    '-L',
    `bus_stops:${filePathFromUrl(new URL('./bus-stops.geojson', sourceDir))}`,
    '-L',
    `bus_stations:${filePathFromUrl(new URL('./bus-stations.geojson', sourceDir))}`,
  ])

  const pmtilesBinary = await ensurePmtilesBinary()
  await execFileAsync(pmtilesBinary, ['convert', mbtilesPath, pmtilesPath])
}

function buildTransitTargets(pokelids) {
  const grouped = new Map()

  for (const lid of pokelids) {
    const gridLat = (Math.round(lid.lat * 4) / 4).toFixed(2)
    const gridLng = (Math.round(lid.lng * 4) / 4).toFixed(2)
    const key = `${gridLat}_${gridLng}`
    const current = grouped.get(key)

    if (!current) {
      grouped.set(key, {
        id: `${lid.prefSlug}-${key}`,
        prefName: lid.prefName,
        lids: [lid],
      })
      continue
    }

    current.lids.push(lid)
  }

  return [...grouped.values()].map((group) => {
    const center = group.lids.reduce(
      (accumulator, lid) => ({
        lat: accumulator.lat + lid.lat,
        lng: accumulator.lng + lid.lng,
      }),
      { lat: 0, lng: 0 },
    )
    const averageLat = center.lat / group.lids.length
    const averageLng = center.lng / group.lids.length
    const radiusKm = Math.min(
      28,
      Math.max(
        12,
        ...group.lids.map((lid) =>
          Math.ceil(
            haversineKm(averageLat, averageLng, lid.lat, lid.lng) + 4,
          ),
        ),
      ),
    )

    return {
      id: group.id,
      lat: Number(averageLat.toFixed(5)),
      lng: Number(averageLng.toFixed(5)),
      prefName: group.prefName,
      radiusMeters: radiusKm * 1000,
    }
  })
}

function buildOverpassQuery(target, mode) {
  const radius = mode === 'rail' ? Math.max(5000, Math.floor(target.radiusMeters * 0.55)) : target.radiusMeters

  if (mode === 'points') {
    return `
[out:json][timeout:120];
(
  node(around:${radius},${target.lat},${target.lng})["railway"~"station|halt|tram_stop"];
  node(around:${radius},${target.lat},${target.lng})["highway"="bus_stop"];
  nwr(around:${radius},${target.lat},${target.lng})["amenity"="bus_station"];
);
out body geom;
`
  }

  return `
[out:json][timeout:120];
(
  way(around:${radius},${target.lat},${target.lng})["railway"~"rail|subway|light_rail|tram|narrow_gauge"];
);
out body geom;
`
}

async function fetchTransitPayload(target) {
  const [points, rail] = await Promise.all([
    fetchOverpassAdaptive(target, target.id, 'points'),
    fetchOverpassAdaptive(target, target.id, 'rail'),
  ])

  const seen = new Set()
  const merged = []

  for (const result of [points, rail]) {
    for (const element of result.elements ?? []) {
      const key = `${element.type}/${element.id}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(element)
      }
    }
  }

  return {
    elements: merged,
    version: 0.6,
  }
}

async function fetchOverpassAdaptive(target, prefSlug, mode, depth = 0) {
  const maxAttempts = 1

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response
    try {
      response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: new URLSearchParams({ data: buildOverpassQuery(target, mode) }),
      })
    } catch {
      response = null
    }

    if (response?.ok) {
      return response.json()
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => {
        setTimeout(resolve, attempt * 1500)
      })
    }
  }

  if (mode === 'rail' || depth >= 0) {
    console.warn(`Skipping ${mode} data for ${prefSlug} after adaptive retries.`)
    return { elements: [], version: 0.6 }
  }
  
  return { elements: [], version: 0.6 }
}

function haversineKm(latA, lngA, latB, lngB) {
  const toRadians = (value) => (value * Math.PI) / 180
  const dLat = toRadians(latB - latA)
  const dLng = toRadians(lngB - lngA)
  const base =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(latA)) *
      Math.cos(toRadians(latB)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  return 6371 * 2 * Math.atan2(Math.sqrt(base), Math.sqrt(1 - base))
}

function normalizeTransitFeature(feature, prefName) {
  const properties = feature.properties ?? {}
  const featureId = properties.id

  if (!featureId) {
    return null
  }

  if (feature.geometry?.type === 'LineString' && properties.railway) {
    return {
      ...feature,
      properties: {
        id: featureId,
        kind: 'rail_route',
        name: properties.name || properties.ref || `Rail ${featureId}`,
        operator: properties.operator || '',
        prefName,
        routeName: properties.name || properties['name:en'] || '',
        routeRef: properties.ref || properties['KSJ2:LIN'] || '',
      },
    }
  }

  const point = coerceToPoint(feature)
  if (!point) {
    return null
  }

  if (['station', 'halt', 'tram_stop'].includes(properties.railway)) {
    return {
      ...point,
      properties: {
        id: featureId,
        kind: 'train_station',
        name:
          properties['name:en'] ||
          properties.name ||
          properties.local_ref ||
          `Station ${featureId}`,
        operator: properties.operator || '',
        prefName,
      },
    }
  }

  if (properties.highway === 'bus_stop') {
    return {
      ...point,
      properties: {
        id: featureId,
        kind: 'bus_stop',
        name:
          properties['name:en'] ||
          properties.name ||
          properties.local_ref ||
          properties.ref ||
          `Bus stop ${featureId}`,
        operator: properties.operator || properties.network || '',
        prefName,
      },
    }
  }

  if (properties.amenity === 'bus_station') {
    return {
      ...point,
      properties: {
        id: featureId,
        kind: 'bus_station',
        name: properties['name:en'] || properties.name || `Bus station ${featureId}`,
        operator: properties.operator || properties.network || '',
        prefName,
      },
    }
  }

  return null
}

function coerceToPoint(feature) {
  if (!feature.geometry) {
    return null
  }

  if (feature.geometry.type === 'Point') {
    return feature
  }

  const ring =
    feature.geometry.type === 'Polygon'
      ? feature.geometry.coordinates[0]
      : feature.geometry.type === 'MultiPolygon'
        ? feature.geometry.coordinates[0][0]
        : null

  if (!ring || ring.length === 0) {
    return null
  }

  const total = ring.reduce(
    (accumulator, [lng, lat]) => ({
      lat: accumulator.lat + lat,
      lng: accumulator.lng + lng,
    }),
    { lat: 0, lng: 0 },
  )

  return {
    ...feature,
    geometry: {
      type: 'Point',
      coordinates: [total.lng / ring.length, total.lat / ring.length],
    },
  }
}

function dedupeFeatures(features) {
  const byId = new Map()

  for (const feature of features) {
    byId.set(feature.properties.id, feature)
  }

  return [...byId.values()]
}

function toPointRecord(feature) {
  return {
    id: feature.properties.id,
    kind: feature.properties.kind,
    lat: feature.geometry.coordinates[1],
    lng: feature.geometry.coordinates[0],
    name: feature.properties.name,
    operator: feature.properties.operator,
    prefName: feature.properties.prefName,
  }
}

function toRouteRecord(feature) {
  const centroid = lineCentroid(feature.geometry.coordinates)

  return {
    centroid,
    id: feature.properties.id,
    kind: feature.properties.kind,
    name: feature.properties.name,
    operator: feature.properties.operator,
    prefName: feature.properties.prefName,
    routeName: feature.properties.routeName,
    routeRef: feature.properties.routeRef,
  }
}

function lineCentroid(coordinates) {
  const total = coordinates.reduce(
    (accumulator, [lng, lat]) => ({
      lat: accumulator.lat + lat,
      lng: accumulator.lng + lng,
    }),
    { lat: 0, lng: 0 },
  )

  return {
    lat: total.lat / coordinates.length,
    lng: total.lng / coordinates.length,
  }
}

async function ensurePmtilesBinary() {
  const version = '1.30.1'
  const platform = process.platform === 'darwin' ? 'Darwin' : 'Linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  const binaryDir = new URL(`./go-pmtiles-${version}/`, TOOL_CACHE_DIR)
  const binaryPath = filePathFromUrl(new URL('./pmtiles', binaryDir))

  try {
    await stat(binaryPath)
    return binaryPath
  } catch {
    // no-op
  }

  await mkdir(binaryDir, { recursive: true })
  const archiveName =
    platform === 'Darwin'
      ? `go-pmtiles-${version}_${platform}_${arch}.zip`
      : `go-pmtiles_${version}_${platform}_${arch}.tar.gz`
  const downloadUrl =
    platform === 'Darwin'
      ? `https://github.com/protomaps/go-pmtiles/releases/download/v${version}/go-pmtiles-${version}_${platform}_${arch}.zip`
      : `https://github.com/protomaps/go-pmtiles/releases/download/v${version}/go-pmtiles_${version}_${platform}_${arch}.tar.gz`

  const archivePath = join(tmpdir(), archiveName)
  const response = await fetch(downloadUrl)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download pmtiles binary (${response.status})`)
  }

  await pipeline(response.body, createWriteStream(archivePath))

  if (platform === 'Darwin') {
    await execFileAsync('unzip', ['-o', archivePath, '-d', filePathFromUrl(binaryDir)])
  } else {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', filePathFromUrl(binaryDir)])
  }

  return binaryPath
}

async function writeJson(filename, payload) {
  await writeFile(new URL(`./${filename}`, PUBLIC_DATA_DIR), `${JSON.stringify(payload, null, 2)}\n`)
}

async function isFileFresh(file, maxAgeMs) {
  try {
    const info = await stat(file)
    return Date.now() - info.mtimeMs < maxAgeMs
  } catch {
    return false
  }
}

function filePathFromUrl(url) {
  return decodeURIComponent(url.pathname)
}
