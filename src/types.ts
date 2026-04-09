export type PokemonEntry = {
  name: string
  number: number
}

export type AccessibilityBand =
  | 'easy'
  | 'fair'
  | 'moderate'
  | 'hard'
  | 'remote'

export type AccessibilityReason =
  | 'station_nearby'
  | 'bus_access'
  | 'ferry_access'
  | 'airport_nearby'
  | 'clustered_trip'
  | 'island'
  | 'mountain'
  | 'transit_sparse'
  | 'remote_area'

export type AccessibilityMetrics = {
  nearbyLids10km: number
  nearestAirportKm: number | null
  nearestBusHubKm: number | null
  nearestFerryKm: number | null
  nearestLidKm: number
  nearestTrainKm: number | null
  isIsland: boolean
  isMountain: boolean
}

export type AccessibilityInfo = {
  score: 1 | 2 | 3 | 4 | 5
  band: AccessibilityBand
  reasons: AccessibilityReason[]
  metrics: AccessibilityMetrics
  confidence: 'estimated' | 'overridden'
}

export type PokeLidRecord = {
  accessibility: AccessibilityInfo
  area: string
  googleMapsUrl: string
  imageUrl: string
  isNew: boolean
  lat: number
  lng: number
  manholeNo: string
  name: string
  pokemon: PokemonEntry[]
  prefName: string
  prefSlug: string
  publishStartDate: string
  searchKeywords: string
  sourceUrl: string
}

export type QueryState = {
  area: string
  newOnly: boolean
  pokemon: string
  pref: string
}
