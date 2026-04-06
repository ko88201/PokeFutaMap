export type PokeLidRecord = {
  area: string
  googleMapsUrl: string
  imageUrl: string
  isNew: boolean
  lat: number
  lng: number
  manholeNo: string
  name: string
  pokemon: string[]
  prefName: string
  prefSlug: string
  publishStartDate: string
  searchKeywords: string
  sourceUrl: string
}

export type TransitPointFeature = {
  id: string
  kind: 'train_station' | 'bus_stop' | 'bus_station'
  lat: number
  lng: number
  name: string
  operator?: string
  prefName?: string
}

export type TransitRouteFeature = {
  centroid: { lat: number; lng: number }
  id: string
  kind: 'rail_route'
  name: string
  operator?: string
  prefName?: string
  routeName?: string
  routeRef?: string
}

export type TransitIndex = {
  busStations: TransitPointFeature[]
  busStops: TransitPointFeature[]
  railRoutes: TransitRouteFeature[]
  stats: {
    totalRailRoutes: number
    totalTransitPoints: number
  }
  trainStations: TransitPointFeature[]
}

export type LayerKey =
  | 'pokeLids'
  | 'railRoutes'
  | 'trainStations'
  | 'busStops'
  | 'busStations'

export type LayerVisibilityState = Record<LayerKey, boolean>

export type QueryState = {
  area: string
  layers: LayerVisibilityState
  newOnly: boolean
  pokemon: string
  pref: string
  q: string
}
