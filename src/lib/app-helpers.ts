import type { AccessFilter, QueryState } from '../types.ts'

const ACCESS_FILTERS = new Set<AccessFilter>(['easy', 'moderate', 'remote'])

export function getInitialQueryState(): QueryState {
  const params = new URLSearchParams(window.location.search)

  return {
    area: params.get('area') ?? '',
    access: parseAccessFilter(params.get('access')),
    keyword: params.get('q') ?? '',
    newOnly: params.get('new') === '1',
    pokemon: params.get('pokemon') ?? '',
    pref: params.get('pref') ?? '',
  }
}

export function getInitialNearbyMode() {
  return new URLSearchParams(window.location.search).get('nearby') === '1'
}

export function queryStateToSearchParams(
  query: QueryState,
  options: { nearby?: boolean } = {},
) {
  const params = new URLSearchParams()

  if (query.pref) params.set('pref', query.pref)
  if (query.area) params.set('area', query.area)
  if (query.pokemon) params.set('pokemon', query.pokemon)
  if (query.keyword) params.set('q', query.keyword)
  if (query.access) params.set('access', query.access)
  if (query.newOnly) params.set('new', '1')
  if (options.nearby) params.set('nearby', '1')

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

export function buildGoogleNavigationLink(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

export function buildGoogleMapsLink(lat: number, lng: number) {
  return `https://maps.google.com/?q=${lat},${lng}`
}

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function parseAccessFilter(value: string | null): AccessFilter {
  if (value && ACCESS_FILTERS.has(value as AccessFilter)) {
    return value as AccessFilter
  }

  return ''
}
