import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const DATA_PATH = new URL('../public/data/pokelids.json', import.meta.url)
const GATEWAY_CITIES_PATH = new URL('./data/gateway-cities.json', import.meta.url)
const INTERNATIONAL_AIRPORTS_PATH = new URL(
  './data/international-airports.json',
  import.meta.url,
)
const OVERRIDES_PATH = new URL('./data/accessibility-overrides.json', import.meta.url)
const SHINKANSEN_STATIONS_PATH = new URL(
  './data/shinkansen-stations.json',
  import.meta.url,
)
const CACHE_DIR = new URL('../.cache/accessibility/', import.meta.url)

const CACHE_VERSION = 'accessibility-v2'
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
]
const BATCH_SIZE = 40
const QUERY_CONCURRENCY = 2
const QUERY_DELAY_MS = 350
const STATIC_BATCH_SIZE = 12

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
  'intl_airport_access',
  'shinkansen_access',
  'gateway_city_access',
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
const gatewayCities = JSON.parse(await readFile(GATEWAY_CITIES_PATH, 'utf8'))
const internationalAirports = JSON.parse(
  await readFile(INTERNATIONAL_AIRPORTS_PATH, 'utf8'),
)
const overrides = JSON.parse(await readFile(OVERRIDES_PATH, 'utf8'))
const shinkansenStationSeeds = JSON.parse(
  await readFile(SHINKANSEN_STATIONS_PATH, 'utf8'),
)

await mkdir(CACHE_DIR, { recursive: true })

const shinkansenStations = await resolveNamedRailStations(shinkansenStationSeeds)

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
    {
      gatewayCities,
      internationalAirports,
      shinkansenStations,
    },
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

function buildAccessibilityRecord(
  lid,
  clusterMetric,
  transportMetric,
  entryReferenceData,
  override,
) {
  const metrics = {
    entryAccessModifier: 0,
    nearestLidKm: clusterMetric.nearestLidKm,
    nearbyLids10km: clusterMetric.nearbyLids10km,
    nearestTrainKm: roundDistance(transportMetric.nearestTrainKm),
    nearestBusHubKm: roundDistance(transportMetric.nearestBusHubKm),
    nearestFerryKm: roundDistance(transportMetric.nearestFerryKm),
    nearestAirportKm: roundDistance(transportMetric.nearestAirportKm),
    nearestIntlAirportKm: null,
    nearestShinkansenKm: null,
    nearestGatewayCityKm: null,
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

  const baseScore = roundedScore
  const entryAccessMetrics = computeEntryAccessMetrics(lid, entryReferenceData)
  metrics.nearestIntlAirportKm = entryAccessMetrics.nearestIntlAirportKm
  metrics.nearestShinkansenKm = entryAccessMetrics.nearestShinkansenKm
  metrics.nearestGatewayCityKm = entryAccessMetrics.nearestGatewayCityKm
  metrics.entryAccessModifier = entryAccessMetrics.entryAccessModifier

  for (const reason of entryAccessMetrics.reasons) {
    reasons.add(reason)
  }

  const finalScore = clamp(
    Math.round(baseScore + entryAccessMetrics.entryAccessModifier),
    1,
    5,
  )

  return {
    ...lid,
    accessibility: {
      score: finalScore,
      band: BAND_BY_SCORE[finalScore],
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

function computeEntryAccessMetrics(lid, referenceData) {
  const nearestIntlAirportKm = roundDistance(
    findNearestDistanceKm(lid, referenceData.internationalAirports),
  )
  const nearestShinkansenKm = roundDistance(
    findNearestDistanceKm(lid, referenceData.shinkansenStations),
  )
  const nearestGatewayCityKm = roundDistance(
    findNearestDistanceKm(lid, referenceData.gatewayCities),
  )

  let entryAccessModifier = 0
  const reasons = new Set()

  if (nearestIntlAirportKm !== null && nearestIntlAirportKm <= 25) {
    entryAccessModifier -= 0.75
    reasons.add('intl_airport_access')
  } else if (nearestIntlAirportKm !== null && nearestIntlAirportKm <= 60) {
    entryAccessModifier -= 0.5
    reasons.add('intl_airport_access')
  }

  if (nearestShinkansenKm !== null && nearestShinkansenKm <= 8) {
    entryAccessModifier -= 0.75
    reasons.add('shinkansen_access')
  } else if (nearestShinkansenKm !== null && nearestShinkansenKm <= 20) {
    entryAccessModifier -= 0.5
    reasons.add('shinkansen_access')
  }

  let gatewayModifier = 0
  if (nearestGatewayCityKm !== null && nearestGatewayCityKm <= 20) {
    gatewayModifier = -0.5
  } else if (nearestGatewayCityKm !== null && nearestGatewayCityKm <= 50) {
    gatewayModifier = -0.25
  }

  if (
    gatewayModifier < -0.25 &&
    (reasons.has('intl_airport_access') || reasons.has('shinkansen_access'))
  ) {
    gatewayModifier = -0.25
  }

  if (gatewayModifier !== 0) {
    entryAccessModifier += gatewayModifier
    reasons.add('gateway_city_access')
  }

  return {
    nearestIntlAirportKm,
    nearestShinkansenKm,
    nearestGatewayCityKm,
    entryAccessModifier: Math.max(entryAccessModifier, -1.5),
    reasons,
  }
}

async function resolveNamedRailStations(entries) {
  const batches = chunk(entries, STATIC_BATCH_SIZE)
  const resolvedStations = []
  const missingStations = []

  for (const [batchIndex, batch] of batches.entries()) {
    console.log(
      `[accessibility] Resolving shinkansen stations batch ${batchIndex + 1}/${batches.length}...`,
    )
    const features = await fetchNamedRailBatch(batch, batchIndex)

    for (const entry of batch) {
      const matched = findNamedRailFeature(entry, features)
      if (!matched) {
        missingStations.push(entry.name)
        continue
      }

      resolvedStations.push({
        id: entry.id,
        name: entry.name,
        lat: matched.lat,
        lng: matched.lng,
      })
    }

    await sleep(QUERY_DELAY_MS)
  }

  if (missingStations.length > 0) {
    throw new Error(
      `Missing shinkansen station coordinates for: ${missingStations.join(', ')}`,
    )
  }

  return resolvedStations
}

async function fetchNamedRailBatch(batch, batchIndex) {
  const batchNames = [...new Set(batch.flatMap((entry) => entry.queryNames ?? [entry.name]))]
  const cacheKey = createHash('sha1')
    .update(CACHE_VERSION)
    .update('named-rail-v1')
    .update(String(batchIndex))
    .update(JSON.stringify(batch))
    .digest('hex')

  const cachePath = new URL(`${cacheKey}.json`, CACHE_DIR)

  try {
    const cached = await readFile(cachePath, 'utf8')
    return JSON.parse(cached)
  } catch {
    // Cache miss; continue to fetch.
  }

  const namePattern = batchNames.map(escapeRegex).join('|')
  const query = [
    '[out:json][timeout:60];(',
    `node["railway"="station"]["name"~"^(${namePattern})$"]["train"!="no"]["station"!="subway"];`,
    `way["railway"="station"]["name"~"^(${namePattern})$"]["train"!="no"]["station"!="subway"];`,
    `relation["railway"="station"]["name"~"^(${namePattern})$"]["train"!="no"]["station"!="subway"];`,
    ');out center tags;',
  ].join('')

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

        const text = await response.text()
        if (!response.ok) {
          if (response.status === 429) {
            await sleep(15_000 * (attempt + 1))
          }
          throw new Error(`Overpass returned ${response.status}`)
        }

        const payload = JSON.parse(text)
        const features = normalizeOverpassElements(payload.elements ?? [])
        await writeFile(cachePath, `${JSON.stringify(features, null, 2)}\n`)
        return features
      } catch (error) {
        lastError = error
      }
    }
  }

  throw new Error(
    `Failed to resolve named rail stations: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}

function findNamedRailFeature(entry, features) {
  const queryNames = entry.queryNames ?? [entry.name]

  for (const queryName of queryNames) {
    const matched = features.find((feature) => feature.name === queryName)
    if (matched) {
      return matched
    }
  }

  return null
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toCacheSeed(lid) {
  return [lid.manholeNo, lid.lat, lid.lng]
}
