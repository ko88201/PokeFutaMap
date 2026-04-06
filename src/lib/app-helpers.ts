import type {
  LayerKey,
  LayerVisibilityState,
  PokeLidRecord,
  QueryState,
} from '../types.ts'

export const DEFAULT_LAYERS: LayerVisibilityState = {
  pokeLids: true,
  railRoutes: true,
  trainStations: true,
  busStops: true,
  busStations: true,
}

export function getInitialQueryState(): QueryState {
  const params = new URLSearchParams(window.location.search)
  const activeLayers = new Set((params.get('layers') ?? '').split(',').filter(Boolean))

  return {
    q: params.get('q') ?? '',
    pref: params.get('pref') ?? '',
    area: params.get('area') ?? '',
    pokemon: params.get('pokemon') ?? '',
    newOnly: params.get('new') === '1',
    layers:
      activeLayers.size > 0
        ? {
            pokeLids: activeLayers.has('pokeLids'),
            railRoutes: activeLayers.has('railRoutes'),
            trainStations: activeLayers.has('trainStations'),
            busStops: activeLayers.has('busStops'),
            busStations: activeLayers.has('busStations'),
          }
        : { ...DEFAULT_LAYERS },
  }
}

export function queryStateToSearchParams(query: QueryState) {
  const params = new URLSearchParams()

  if (query.q) params.set('q', query.q)
  if (query.pref) params.set('pref', query.pref)
  if (query.area) params.set('area', query.area)
  if (query.pokemon) params.set('pokemon', query.pokemon)
  if (query.newOnly) params.set('new', '1')

  const layers = (Object.entries(query.layers) as [LayerKey, boolean][])
    .filter(([, value]) => value)
    .map(([key]) => key)

  if (layers.length > 0 && layers.length < Object.keys(DEFAULT_LAYERS).length) {
    params.set('layers', layers.join(','))
  }

  return params
}

export function updateLocationSearch(params: URLSearchParams) {
  const nextPath = `${window.location.pathname}${params.size ? `?${params.toString()}` : ''}`
  window.history.replaceState({}, '', nextPath)
}

export function areaLabel(area: string) {
  switch (area) {
    case 'hokkaido':
      return '北海道'
    case 'tohoku':
      return '東北'
    case 'kanto':
      return '関東'
    case 'chubu':
      return '中部'
    case 'kinki':
      return '近畿'
    case 'chugoku':
      return '中国'
    case 'shikoku':
      return '四国'
    case 'kyushu':
      return '九州'
    case 'okinawa':
      return '沖縄'
    default:
      return area
  }
}

export function getLayerLabel(layer: LayerKey) {
  switch (layer) {
    case 'pokeLids':
      return 'ポケふた'
    case 'railRoutes':
      return '鉄道路線'
    case 'trainStations':
      return '駅'
    case 'busStops':
      return 'バス停'
    case 'busStations':
      return 'バスターミナル'
  }
}

export function getPokemonSearchHaystack(lid: PokeLidRecord) {
  return [
    lid.name,
    lid.prefName,
    lid.area,
    ...lid.pokemon,
    lid.searchKeywords,
  ]
    .join(' ')
    .toLowerCase()
}

export function buildGoogleMapsLink(lat: number, lng: number) {
  return `https://maps.google.com/?q=${lat},${lng}`
}

export function haversineKilometers(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
) {
  const toRadians = (value: number) => (value * Math.PI) / 180
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

export function formatDistance(distanceKm: number) {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)}m`
  }

  return `${distanceKm.toFixed(1)}km`
}

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}
