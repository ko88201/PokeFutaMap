import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const DATA_PATH = new URL('../public/data/pokelids.json', import.meta.url)
const OVERRIDES_PATH = new URL('./data/accessibility-overrides.json', import.meta.url)
const CACHE_DIR = new URL('../.cache/accessibility/', import.meta.url)

const CACHE_VERSION = 'accessibility-v2'
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
]
const BATCH_SIZE = 40
const QUERY_CONCURRENCY = 2
const QUERY_DELAY_MS = 350

const FEATURE_SPECS = [
  {
    concurrency: 2,
    key: 'train',
    metricKey: 'nearestTrainKm',
    label: 'train stations',
    queryLinesForLid(lid) {
      return [
        `nwr(around:15000,${lid.lat},${lid.lng})[railway~"^(station|halt|tram_stop)$"];`,
      ]
    },
  },
  {
    cacheSalt: 'bus-v2',
    concurrency: 1,
    key: 'bus',
    metricKey: 'nearestBusHubKm',
    label: 'bus access',
    queryLinesForLid(lid) {
      return [
        `nwr(around:5000,${lid.lat},${lid.lng})[amenity=bus_station];`,
        `nwr(around:1500,${lid.lat},${lid.lng})[highway=bus_stop];`,
        `nwr(around:1500,${lid.lat},${lid.lng})[public_transport=platform][bus=yes];`,
        `nwr(around:1500,${lid.lat},${lid.lng})[public_transport=stop_position][bus=yes];`,
      ]
    },
  },
  {
    concurrency: 1,
    key: 'ferry',
    metricKey: 'nearestFerryKm',
    label: 'ferry terminals',
    queryLinesForLid(lid) {
      return [
        `nwr(around:5000,${lid.lat},${lid.lng})[amenity=ferry_terminal];`,
        `nwr(around:5000,${lid.lat},${lid.lng})[public_transport=station][ferry=yes];`,
      ]
    },
  },
  {
    concurrency: 2,
    key: 'airport',
    metricKey: 'nearestAirportKm',
    label: 'airports',
    queryLinesForLid(lid) {
      return [
        `nwr(around:80000,${lid.lat},${lid.lng})[aeroway=aerodrome];`,
      ]
    },
  },
]

const REASON_ORDER = [
  'station_nearby',
  'bus_access',
  'ferry_access',
  'airport_nearby',
  'clustered_trip',
  'island',
  'mountain',
  'transit_sparse',
  'remote_area',
]

const BAND_BY_SCORE = {
  1: 'easy',
  2: 'fair',
  3: 'moderate',
  4: 'hard',
  5: 'remote',
}

const lids = JSON.parse(await readFile(DATA_PATH, 'utf8'))
const overrides = JSON.parse(await readFile(OVERRIDES_PATH, 'utf8'))

await mkdir(CACHE_DIR, { recursive: true })

const transportMetrics = Object.fromEntries(
  lids.map((lid) => [
    lid.manholeNo,
    {
      nearestTrainKm: null,
      nearestBusHubKm: null,
      nearestFerryKm: null,
      nearestAirportKm: null,
    },
  ]),
)

for (const spec of FEATURE_SPECS) {
  const batches = chunk(lids, BATCH_SIZE)
  const batchEntries = batches.map((batch, batchIndex) => [batchIndex, batch])
  const concurrency = spec.concurrency ?? QUERY_CONCURRENCY

  for (const batchGroup of chunk(batchEntries, concurrency)) {
    const results = await Promise.all(
      batchGroup.map(async ([batchIndex, batch]) => {
        console.log(
          `[accessibility] Fetching ${spec.label} batch ${batchIndex + 1}/${batches.length}...`,
        )
        const features = await fetchFeaturesForBatch(spec, batch, batchIndex)
        return { batch, features }
      }),
    )

    for (const { batch, features } of results) {
      for (const lid of batch) {
        const metricValue = findNearestDistanceKm(lid, features)
        transportMetrics[lid.manholeNo][spec.metricKey] = metricValue
      }
    }

    await sleep(QUERY_DELAY_MS)
  }
}

const clusterMetrics = computeClusterMetrics(lids)
const enriched = lids.map((lid) =>
  buildAccessibilityRecord(
    lid,
    clusterMetrics[lid.manholeNo],
    transportMetrics[lid.manholeNo],
    overrides[lid.manholeNo] ?? null,
  ),
)

await writeFile(DATA_PATH, `${JSON.stringify(enriched, null, 2)}\n`)

const distribution = enriched.reduce((accumulator, lid) => {
  accumulator[lid.accessibility.score] =
    (accumulator[lid.accessibility.score] ?? 0) + 1
  return accumulator
}, {})

console.log(
  `[accessibility] Wrote accessibility data for ${enriched.length} Poké Lids.`,
)
console.log(`[accessibility] Score distribution: ${JSON.stringify(distribution)}`)

async function fetchFeaturesForBatch(spec, lidsBatch, batchIndex) {
  const query = buildOverpassQuery(spec, lidsBatch)
  const cacheKey = createHash('sha1')
    .update(CACHE_VERSION)
    .update(spec.cacheSalt ?? spec.key)
    .update(String(batchIndex))
    .update(JSON.stringify(lidsBatch.map(toCacheSeed)))
    .digest('hex')

  const cachePath = new URL(`${cacheKey}.json`, CACHE_DIR)

  try {
    const cached = await readFile(cachePath, 'utf8')
    return JSON.parse(cached)
  } catch {
    // Cache miss; continue to fetch.
  }

  let lastError = null
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'text/plain;charset=UTF-8',
            accept: 'application/json',
          },
          body: query,
          signal: AbortSignal.timeout(90_000),
        })

        if (response.status === 429) {
          await sleep(15_000 * (attempt + 1))
          throw new Error(`Overpass returned ${response.status}`)
        }

        if (!response.ok) {
          throw new Error(`Overpass returned ${response.status}`)
        }

        const payload = await response.json()
        const features = normalizeOverpassElements(payload.elements ?? [])
        await writeFile(cachePath, `${JSON.stringify(features, null, 2)}\n`)
        return features
      } catch (error) {
        lastError = error
      }
    }
  }

  throw new Error(
    `Failed to fetch ${spec.key} data from Overpass: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

function buildOverpassQuery(spec, lidsBatch) {
  const selectors = lidsBatch.flatMap((lid) => spec.queryLinesForLid(lid))

  return `[out:json][timeout:90];\n(\n${selectors.join('\n')}\n);\nout center tags;`
}

function normalizeOverpassElements(elements) {
  const deduped = new Map()

  for (const element of elements) {
    const lat = element.lat ?? element.center?.lat
    const lng = element.lon ?? element.center?.lon

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue
    }

    deduped.set(`${element.type}/${element.id}`, {
      id: `${element.type}/${element.id}`,
      lat,
      lng,
      name: element.tags?.name ?? '',
    })
  }

  return [...deduped.values()]
}

function computeClusterMetrics(allLids) {
  const metrics = {}
  for (const lid of allLids) {
    let nearestLidKm = Number.POSITIVE_INFINITY
    let nearbyLids10km = 0

    for (const other of allLids) {
      if (other.manholeNo === lid.manholeNo) {
        continue
      }

      const distanceKm = haversineKm(lid, other)
      if (distanceKm < nearestLidKm) {
        nearestLidKm = distanceKm
      }

      if (distanceKm <= 10) {
        nearbyLids10km += 1
      }
    }

    metrics[lid.manholeNo] = {
      nearestLidKm: roundDistance(nearestLidKm),
      nearbyLids10km,
    }
  }

  return metrics
}

function buildAccessibilityRecord(lid, clusterMetric, transportMetric, override) {
  const metrics = {
    nearestLidKm: clusterMetric.nearestLidKm,
    nearbyLids10km: clusterMetric.nearbyLids10km,
    nearestTrainKm: roundDistance(transportMetric.nearestTrainKm),
    nearestBusHubKm: roundDistance(transportMetric.nearestBusHubKm),
    nearestFerryKm: roundDistance(transportMetric.nearestFerryKm),
    nearestAirportKm: roundDistance(transportMetric.nearestAirportKm),
    isIsland: override?.isIsland ?? false,
    isMountain: override?.isMountain ?? false,
  }

  let score = 3
  const reasons = new Set()

  if (metrics.nearestTrainKm !== null && metrics.nearestTrainKm <= 1) {
    score -= 1
    reasons.add('station_nearby')
  } else if (metrics.nearestTrainKm !== null && metrics.nearestTrainKm <= 5) {
    score -= 0.5
    reasons.add('station_nearby')
  } else if (metrics.nearestTrainKm === null || metrics.nearestTrainKm > 15) {
    score += 1
  } else if (metrics.nearestTrainKm > 5) {
    score += 0.5
  }

  const walkableBus = metrics.nearestBusHubKm !== null && metrics.nearestBusHubKm <= 1
  const walkableFerry = metrics.nearestFerryKm !== null && metrics.nearestFerryKm <= 1

  if ((metrics.nearestTrainKm === null || metrics.nearestTrainKm > 5) && walkableBus) {
    score -= 0.5
    reasons.add('bus_access')
  }

  if ((metrics.nearestTrainKm === null || metrics.nearestTrainKm > 5) && walkableFerry) {
    score -= 0.5
    reasons.add('ferry_access')
  }

  const transitSparse =
    (metrics.nearestTrainKm === null || metrics.nearestTrainKm > 15) &&
    (metrics.nearestBusHubKm === null || metrics.nearestBusHubKm > 5) &&
    (metrics.nearestFerryKm === null || metrics.nearestFerryKm > 5)

  if (transitSparse) {
    score += 0.5
    reasons.add('transit_sparse')
  }

  let terrainDelta = 0
  if (metrics.isIsland) {
    terrainDelta += 1
    reasons.add('island')
  }
  if (metrics.isMountain) {
    terrainDelta += 1
    reasons.add('mountain')
  }
  score += Math.min(terrainDelta, 2)

  if (metrics.nearestAirportKm !== null && metrics.nearestAirportKm <= 25) {
    score -= 0.5
    reasons.add('airport_nearby')
  }

  if (
    metrics.isIsland &&
    (metrics.nearestAirportKm === null || metrics.nearestAirportKm > 80)
  ) {
    score += 0.5
  }

  let clusterReduction = 0
  if (metrics.nearestLidKm <= 3) {
    clusterReduction += 0.5
  }
  if (metrics.nearbyLids10km >= 3) {
    clusterReduction += 0.5
  }

  if (clusterReduction > 0) {
    reasons.add('clustered_trip')
  }

  score -= Math.min(clusterReduction, 1)

  if (override?.scoreAdjustment) {
    score += override.scoreAdjustment
  }

  if (Array.isArray(override?.addReasons)) {
    for (const reason of override.addReasons) {
      reasons.add(reason)
    }
  }

  let roundedScore = clamp(Math.round(score), 1, 5)
  if (typeof override?.fixedScore === 'number') {
    roundedScore = clamp(override.fixedScore, 1, 5)
  }

  if (
    roundedScore >= 5 ||
    (metrics.isIsland && metrics.nearestAirportKm === null) ||
    (transitSparse && metrics.nearestLidKm >= 40)
  ) {
    reasons.add('remote_area')
  }

  if (Array.isArray(override?.removeReasons)) {
    for (const reason of override.removeReasons) {
      reasons.delete(reason)
    }
  }

  return {
    ...lid,
    accessibility: {
      score: roundedScore,
      band: BAND_BY_SCORE[roundedScore],
      reasons: REASON_ORDER.filter((reason) => reasons.has(reason)),
      metrics,
      confidence: override ? 'overridden' : 'estimated',
    },
  }
}

function findNearestDistanceKm(lid, features) {
  let best = Number.POSITIVE_INFINITY

  for (const feature of features) {
    const distanceKm = haversineKm(lid, feature)
    if (distanceKm < best) {
      best = distanceKm
    }
  }

  return Number.isFinite(best) ? best : null
}

function haversineKm(left, right) {
  const earthRadiusKm = 6371
  const lat1 = toRadians(left.lat)
  const lat2 = toRadians(right.lat)
  const dLat = toRadians(right.lat - left.lat)
  const dLng = toRadians(right.lng - left.lng)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a))
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function roundDistance(value) {
  if (value === null || !Number.isFinite(value)) {
    return null
  }

  return Math.round(value * 100) / 100
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function chunk(values, size) {
  const chunks = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

function toCacheSeed(lid) {
  return [lid.manholeNo, lid.lat, lid.lng]
}
