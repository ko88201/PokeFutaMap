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

export type AccessibilityScore = 1 | 2 | 3 | 4 | 5

export type AccessibilityReason =
  | 'station_nearby'
  | 'bus_access'
  | 'ferry_access'
  | 'airport_nearby'
  | 'intl_airport_access'
  | 'shinkansen_access'
  | 'gateway_city_access'
  | 'clustered_trip'
  | 'island'
  | 'mountain'
  | 'transit_sparse'
  | 'remote_area'

export type AccessibilityMetrics = {
  entryAccessModifier: number
  nearbyLids10km: number
  nearestAirportKm: number | null
  nearestBusHubKm: number | null
  nearestFerryKm: number | null
  nearestGatewayCityKm: number | null
  nearestIntlAirportKm: number | null
  nearestLidKm: number
  nearestShinkansenKm: number | null
  nearestTrainKm: number | null
  isIsland: boolean
  isMountain: boolean
}

export type AccessibilityInfo = {
  score: AccessibilityScore
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

export type UserLocation = {
  lat: number
  lng: number
}

export type WorkspaceLayoutState = {
  desktopPanelOpen: boolean
  mobilePanelOpen: boolean
}

export type QueryState = {
  area: string
  accessScores: AccessibilityScore[]
  newOnly: boolean
  pokemon: string
  pref: string
}
