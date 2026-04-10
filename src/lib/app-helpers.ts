import type { AccessibilityScore, QueryState } from '../types.ts'

const ACCESS_SCORES = [1, 2, 3, 4, 5] as const
const LEGACY_ACCESS_SCORES = {
  easy: [1, 2],
  moderate: [3],
  remote: [4, 5],
} as const satisfies Record<string, AccessibilityScore[]>

export function getInitialQueryState(): QueryState {
  const params = new URLSearchParams(window.location.search)

  return {
    area: params.get('area') ?? '',
    accessScores: parseAccessScores(params),
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
  if (query.accessScores.length > 0) {
    params.set('scores', sortAccessScores(query.accessScores).join(','))
  }
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

function parseAccessScores(params: URLSearchParams): AccessibilityScore[] {
  const scoresParam = params.get('scores')
  if (scoresParam) {
    const scores = scoresParam
      .split(',')
      .map((value) => Number(value.trim()))
      .filter(isAccessibilityScore)

    if (scores.length > 0) {
      return sortAccessScores(scores)
    }
  }

  const legacyAccess = params.get('access')
  if (legacyAccess && legacyAccess in LEGACY_ACCESS_SCORES) {
    return [...LEGACY_ACCESS_SCORES[legacyAccess as keyof typeof LEGACY_ACCESS_SCORES]]
  }

  return []
}

function isAccessibilityScore(value: number): value is AccessibilityScore {
  return ACCESS_SCORES.includes(value as AccessibilityScore)
}

function sortAccessScores(scores: AccessibilityScore[]) {
  return [...new Set(scores)].sort((left, right) => left - right)
}
