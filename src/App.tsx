import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { MapPane } from './components/MapPane.tsx'
import {
  areaLabel,
  buildGoogleNavigationLink,
  classNames,
  getInitialNearbyMode,
  getInitialQueryState,
  queryStateToSearchParams,
  updateLocationSearch,
} from './lib/app-helpers.ts'
import {
  ACCESSIBILITY_VISUALS,
  getAccessibilityBandLabel,
  getAccessibilityReasonLabel,
  getAccessibilityVisual,
} from './lib/accessibility.ts'
import type {
  AccessibilityScore,
  PokemonEntry,
  PokeLidRecord,
  QueryState,
  UserLocation,
} from './types.ts'

type DataState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; lids: PokeLidRecord[] }
  | { status: 'error'; message: string }

type LocationStatus = 'idle' | 'locating' | 'ready' | 'unsupported' | 'denied' | 'error'

const AREA_OPTIONS = [
  'hokkaido',
  'tohoku',
  'kanto',
  'chubu',
  'kinki',
  'chugoku',
  'shikoku',
  'kyushu',
  'okinawa',
] as const

const DEFAULT_QUERY: QueryState = {
  area: '',
  accessScores: [],
  newOnly: false,
  pokemon: '',
  pref: '',
}

const DESKTOP_BREAKPOINT = 980

function App() {
  const [dataState, setDataState] = useState<DataState>({ status: 'loading' })
  const [query, setQuery] = useState<QueryState>(() => getInitialQueryState())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= DESKTOP_BREAKPOINT)
  const [nearbyMode, setNearbyMode] = useState(() => getInitialNearbyMode())
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle')
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const [locateSignal, setLocateSignal] = useState(0)
  const hasTriedInitialNearbyRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const lidsResponse = await fetch(`${import.meta.env.BASE_URL}data/pokelids.json`)

        if (!lidsResponse.ok) {
          throw new Error('Site data was not generated yet.')
        }

        const lids = (await lidsResponse.json()) as PokeLidRecord[]

        if (!cancelled) {
          setDataState({ status: 'ready', lids })
        }
      } catch (error) {
        if (!cancelled) {
          setDataState({
            status: 'error',
            message:
              error instanceof Error ? error.message : 'Failed to load site data.',
          })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    updateLocationSearch(queryStateToSearchParams(query, { nearby: nearbyMode }))
  }, [nearbyMode, query])

  useEffect(() => {
    if (dataState.status !== 'ready') {
      return
    }

    if (!nearbyMode || userLocation || locationStatus === 'locating') {
      return
    }

    if (hasTriedInitialNearbyRef.current) {
      return
    }

    hasTriedInitialNearbyRef.current = true
    setLocationStatus('locating')
    requestCurrentLocation({
      onError: (status) => {
        setLocationStatus(status)
        setNearbyMode(false)
      },
      onSuccess: (location) => {
        setUserLocation(location)
        setNearbyMode(true)
        setLocationStatus('ready')
        setLocateSignal((value) => value + 1)
      },
    })
  }, [dataState.status, locationStatus, nearbyMode, userLocation])

  const readyLids = dataState.status === 'ready' ? dataState.lids : []
  const pokemonMap = new Map<number, PokemonEntry>()
  for (const lid of readyLids) {
    for (const pokemon of lid.pokemon) {
      pokemonMap.set(pokemon.number, pokemon)
    }
  }

  const allPokemon = [...pokemonMap.values()].sort((left, right) => left.number - right.number)
  const allPrefectures = [...new Set<string>(readyLids.map((lid) => lid.prefName))].sort()
  const distanceById = buildDistanceMap(readyLids, userLocation)
  const filteredLids = filterLids(readyLids, query)
  const visibleLids = sortLids(filteredLids, distanceById, nearbyMode, userLocation)
  const activeLid =
    visibleLids.find((lid) => lid.manholeNo === activeId) ??
    readyLids.find((lid) => lid.manholeNo === activeId) ??
    null
  const summaryLid = activeLid ?? (nearbyMode ? visibleLids[0] ?? null : null)
  const filterTags = buildFilterTags(query, nearbyMode)

  useEffect(() => {
    if (!activeId) {
      return
    }

    const stillVisible = visibleLids.some((lid) => lid.manholeNo === activeId)
    if (!stillVisible) {
      setActiveId(null)
    }
  }, [activeId, visibleLids])

  if (dataState.status === 'loading' || dataState.status === 'idle') {
    return (
      <main className="app-shell status-shell">
        <section className="status-screen">
          <p className="eyebrow">Reachability Atlas</p>
          <h1>PokeFutaMap を準備しています</h1>
          <p>日本中のポケふたと、移動しやすさのレイヤーを読み込んでいます。</p>
        </section>
      </main>
    )
  }

  if (dataState.status === 'error') {
    return (
      <main className="app-shell status-shell">
        <section className="status-screen">
          <p className="eyebrow">Reachability Atlas</p>
          <h1>データの読み込みに失敗しました</h1>
          <p>{dataState.message}</p>
        </section>
      </main>
    )
  }

  function setQueryValue<Key extends keyof QueryState>(key: Key, value: QueryState[Key]) {
    setQuery((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function resetFilters() {
    setQuery(DEFAULT_QUERY)
    setNearbyMode(false)
    setActiveId(null)
    setLocationStatus(userLocation ? 'ready' : 'idle')
    setResetSignal((value) => value + 1)
  }

  function handlePanelToggle() {
    setPanelOpen((open) => !open)
  }

  function handleResetView() {
    setActiveId(null)
    setResetSignal((value) => value + 1)
  }

  function handleNearbyToggle() {
    if (nearbyMode) {
      setNearbyMode(false)
      setLocationStatus(userLocation ? 'ready' : 'idle')
      return
    }

    if (userLocation) {
      setNearbyMode(true)
      setLocationStatus('ready')
      setLocateSignal((value) => value + 1)
      return
    }

    setLocationStatus('locating')
    requestCurrentLocation({
      onError: (status) => {
        setLocationStatus(status)
        setNearbyMode(false)
      },
      onSuccess: (location) => {
        setUserLocation(location)
        setNearbyMode(true)
        setLocationStatus('ready')
        setLocateSignal((value) => value + 1)
      },
    })
  }

  function handleListSelect(manholeNo: string) {
    setActiveId(manholeNo)

    if (window.innerWidth < DESKTOP_BREAKPOINT) {
      setPanelOpen(false)
      return
    }

    setPanelOpen(true)
  }

  function handleMapSelect(manholeNo: string | null) {
    setActiveId(manholeNo)

    if (!manholeNo) {
      return
    }

    if (window.innerWidth >= DESKTOP_BREAKPOINT) {
      setPanelOpen(true)
    }
  }

  return (
    <main className="app-shell">
      <MapPane
        activeId={activeLid?.manholeNo ?? null}
        activeLid={activeLid}
        allLids={readyLids}
        locateSignal={locateSignal}
        onSelect={handleMapSelect}
        resetSignal={resetSignal}
        userLocation={nearbyMode ? userLocation : null}
        visibleLids={visibleLids}
      />

      <header className="topbar">
        <div className="topbar-actions">
          <ControlButton
            active={panelOpen}
            icon={<FilterIcon />}
            onClick={handlePanelToggle}
          >
            {panelOpen ? 'パネルを閉じる' : '検索と一覧'}
          </ControlButton>
          <ControlButton
            active={nearbyMode}
            icon={<LocateIcon />}
            onClick={handleNearbyToggle}
          >
            {nearbyMode ? '近く順を解除' : '現在地'}
          </ControlButton>
          <ControlButton icon={<CompassIcon />} onClick={handleResetView}>
            全体表示
          </ControlButton>
        </div>
      </header>

      <AttributionDisclosure />

      <section className={classNames('sheet', panelOpen && 'open')}>
        <div className="sheet-summary">
          <button
            aria-expanded={panelOpen}
            aria-label={panelOpen ? 'パネルを折りたたむ' : 'パネルを展開する'}
            className="sheet-handle"
            onClick={handlePanelToggle}
            type="button"
          >
            <span />
          </button>

          <div className="summary-header">
            <div>
              <p className="eyebrow">Map Console</p>
              <h2>{visibleLids.length} spots</h2>
            </div>
          </div>

          <div className="summary-meta" aria-label="地圖狀態摘要">
            <span className="summary-meta-chip">
              {nearbyMode ? 'Nearby' : 'National'}
            </span>
            <span className="summary-meta-chip">
              {query.accessScores.length > 0
                ? formatAccessScoreSummary(query.accessScores)
                : '1-5'}
            </span>
          </div>

          <div className="summary-legend" aria-label="行きやすさで絞り込む">
            <div className="summary-legend-scale">
              {ACCESSIBILITY_VISUALS.map((entry) => (
                <button
                  aria-label={`${entry.score} ${entry.label}`}
                  aria-pressed={query.accessScores.includes(entry.score)}
                  className={classNames(
                    'summary-legend-item',
                    query.accessScores.includes(entry.score) && 'active',
                    query.accessScores.length > 0 &&
                      !query.accessScores.includes(entry.score) &&
                      'muted',
                  )}
                  key={entry.score}
                  onClick={() => {
                    setQueryValue(
                      'accessScores',
                      toggleAccessScore(query.accessScores, entry.score),
                    )
                  }}
                  title={entry.label}
                  type="button"
                >
                  <span
                    className="legend-dot"
                    style={{ '--score-color': entry.color } as CSSProperties}
                  >
                    {entry.score}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {filterTags.length > 0 || query.accessScores.length === 0 ? (
            <div className="summary-chip-row">
              {filterTags.length > 0 ? (
                filterTags.map((tag) => (
                  <span className="summary-chip" key={tag}>
                    {tag}
                  </span>
                ))
              ) : (
                <span className="summary-chip summary-chip-muted">フィルターなし</span>
              )}
            </div>
          ) : null}

          {summaryLid ? (
            <SummarySpotlight
              distanceKm={distanceById.get(summaryLid.manholeNo) ?? null}
              label={activeLid ? '選択中のポケふた' : '現在地から最寄り'}
              lid={summaryLid}
            />
          ) : null}
        </div>

        <div className="sheet-body">
          <div className="sheet-scroll">
            <section className="panel-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Filters</p>
                  <h3>絞り込み</h3>
                </div>
                <p>一覧と地図に同じ条件が反映されます。</p>
              </div>

              <div className="field-grid">
                <FilterSelect
                  label="都道府県"
                  onChange={(value) => setQueryValue('pref', value)}
                  options={[
                    { label: 'すべての都道府県', value: '' },
                    ...allPrefectures.map((prefecture) => ({
                      label: prefecture,
                      value: prefecture,
                    })),
                  ]}
                  value={query.pref}
                />
                <FilterSelect
                  label="エリア"
                  onChange={(value) => setQueryValue('area', value)}
                  options={[
                    { label: 'すべてのエリア', value: '' },
                    ...AREA_OPTIONS.map((area) => ({
                      label: areaLabel(area),
                      value: area,
                    })),
                  ]}
                  value={query.area}
                />
                <FilterSelect
                  label="ポケモン"
                  onChange={(value) => setQueryValue('pokemon', value)}
                  options={[
                    { label: 'すべてのポケモン', value: '' },
                    ...allPokemon.map((pokemon) => ({
                      label: formatPokemonLabel(pokemon),
                      value: String(pokemon.number),
                    })),
                  ]}
                  value={query.pokemon}
                />
              </div>

              <div className="utility-row">
                <button
                  aria-pressed={query.newOnly}
                  className={classNames('toggle-card', query.newOnly && 'active')}
                  onClick={() => setQueryValue('newOnly', !query.newOnly)}
                  type="button"
                >
                  <span>
                    <strong>新着のみ表示</strong>
                    <small>
                      {query.newOnly
                        ? '最近公開されたポケふたを表示中'
                        : 'すべての公開分を表示中'}
                    </small>
                  </span>
                  <span className="toggle-indicator" aria-hidden="true" />
                </button>

                <button className="ghost-action" onClick={resetFilters} type="button">
                  条件をクリア
                </button>
              </div>
            </section>

            {activeLid ? (
              <section className="panel-section">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Selected</p>
                    <h3>スポット詳細</h3>
                  </div>
                  <p>ナビや公式ページへ直接移動できます。</p>
                </div>

                <DetailCard
                  distanceKm={distanceById.get(activeLid.manholeNo) ?? null}
                  lid={activeLid}
                />
              </section>
            ) : null}

            <section className="panel-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Collection</p>
                  <h3>ポケふた一覧</h3>
                </div>
                <p>
                  {nearbyMode && userLocation
                    ? '現在地から近い順'
                    : 'マップと連動する全スポット一覧'}
                </p>
              </div>

              <div className="result-list">
                {visibleLids.map((lid) => (
                  <button
                    aria-pressed={lid.manholeNo === activeLid?.manholeNo}
                    className={classNames(
                      'result-card',
                      lid.manholeNo === activeLid?.manholeNo && 'active',
                    )}
                    key={lid.manholeNo}
                    onClick={() => handleListSelect(lid.manholeNo)}
                    type="button"
                  >
                    <div className="result-card-header">
                      <div className="result-score">
                        <span
                          className="score-badge"
                          style={
                            {
                              '--score-color':
                                getAccessibilityVisual(lid.accessibility.score).color,
                            } as CSSProperties
                          }
                        >
                          {lid.accessibility.score}
                        </span>
                        <div>
                          <strong>{lid.name}</strong>
                          <p>
                            {lid.prefName} · {areaLabel(lid.area)}
                          </p>
                        </div>
                      </div>
                      <div className="result-meta">
                        {lid.isNew ? <span className="inline-badge">新着</span> : null}
                        {nearbyMode && userLocation ? (
                          <span className="distance-pill">
                            {formatDistance(distanceById.get(lid.manholeNo) ?? null)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="result-pokemon">
                      {lid.pokemon.map(formatPokemonLabel).join(' · ')}
                    </p>
                    <div className="result-tags">
                      <span className="band-pill">
                        {getAccessibilityBandLabel(lid.accessibility.band)}
                      </span>
                      {lid.accessibility.reasons.slice(0, 2).map((reason) => (
                        <span className="reason-pill" key={reason}>
                          {getAccessibilityReasonLabel(reason)}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}

                {visibleLids.length === 0 ? (
                  <div className="empty-state">
                    <strong>条件に合うポケふたが見つかりません。</strong>
                    <p>キーワードや reachability 条件を少しゆるめてみてください。</p>
                    <button className="ghost-action" onClick={resetFilters} type="button">
                      すべて解除する
                    </button>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  )
}

function ControlButton({
  active = false,
  children,
  icon,
  onClick,
}: {
  active?: boolean
  children: ReactNode
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={classNames('control-button', active && 'active')}
      onClick={onClick}
      type="button"
    >
      <span className="control-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </button>
  )
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: Array<{ label: string; value: string }>
  value: string
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="field-control">
        <select onChange={(event) => onChange(event.target.value)} value={value}>
          {options.map((option) => (
            <option key={`${label}-${option.value || 'all'}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  )
}

function SummarySpotlight({
  distanceKm,
  label,
  lid,
}: {
  distanceKm: number | null
  label: string
  lid: PokeLidRecord
}) {
  const visual = getAccessibilityVisual(lid.accessibility.score)

  return (
    <article className="summary-spotlight">
      <img alt={lid.name} loading="lazy" src={lid.imageUrl} />
      <div className="summary-spotlight-copy">
        <div className="summary-spotlight-header">
          <span>{label}</span>
          <strong
            className="score-pill"
            style={{ '--score-color': visual.color } as CSSProperties}
          >
            Reach {lid.accessibility.score}
          </strong>
        </div>
        <h3>{lid.name}</h3>
        <p>
          {lid.prefName} · {areaLabel(lid.area)}
        </p>
        <div className="summary-spotlight-meta">
          <span>{getAccessibilityBandLabel(lid.accessibility.band)}</span>
          {distanceKm !== null ? <span>{formatDistance(distanceKm)}</span> : null}
        </div>
      </div>
    </article>
  )
}

function DetailCard({
  distanceKm,
  lid,
}: {
  distanceKm: number | null
  lid: PokeLidRecord
}) {
  const visual = getAccessibilityVisual(lid.accessibility.score)

  return (
    <article className="detail-card">
      <img alt={lid.name} loading="lazy" src={lid.imageUrl} />
      <div className="detail-copy">
        <div className="detail-header">
          <p>
            {lid.prefName} · {areaLabel(lid.area)} · ポケふた #{lid.manholeNo}
          </p>
          <strong>{lid.name}</strong>
        </div>

        <div className="detail-access">
          <span
            className="score-pill"
            style={{ '--score-color': visual.color } as CSSProperties}
          >
            Reachability {lid.accessibility.score} / 5
          </span>
          <span className="band-pill">{getAccessibilityBandLabel(lid.accessibility.band)}</span>
          {distanceKm !== null ? (
            <span className="distance-pill">{formatDistance(distanceKm)}</span>
          ) : null}
          {lid.isNew ? <span className="inline-badge">新着</span> : null}
        </div>

        <p className="detail-pokemon-line">
          {lid.pokemon.map(formatPokemonLabel).join(' · ')}
        </p>

        <div className="detail-tags">
          {lid.accessibility.reasons.map((reason) => (
            <span className="reason-pill" key={reason}>
              {getAccessibilityReasonLabel(reason)}
            </span>
          ))}
        </div>

        <div className="detail-actions">
          <a href={lid.sourceUrl} rel="noreferrer" target="_blank">
            公式ページ
          </a>
          <a href={lid.googleMapsUrl} rel="noreferrer" target="_blank">
            Googleマップ
          </a>
          <a href={buildGoogleNavigationLink(lid.lat, lid.lng)} rel="noreferrer" target="_blank">
            Googleでナビ
          </a>
        </div>
      </div>
    </article>
  )
}

const AttributionDisclosure = () => {
  return (
    <div aria-label="地圖資料提供元" className="attribution-mini" role="note">
      <div className="attribution-line" title="OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors">
        OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors
      </div>
    </div>
  )
}

function FilterIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path
        d="M4 7h16M7 12h10M10 17h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function LocateIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path
        d="M12 3v3m0 12v3m9-9h-3M6 12H3m14.2 0A5.2 5.2 0 1 1 12 6.8a5.2 5.2 0 0 1 5.2 5.2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function CompassIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path
        d="M14.6 9.4 9.8 11l1.6 4.8 4.8-1.6 1.6-4.8-4.8 1.6ZM12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function filterLids(lids: PokeLidRecord[], query: QueryState) {
  return lids.filter((lid) => {
    if (query.pref && lid.prefName !== query.pref) {
      return false
    }

    if (query.area && lid.area !== query.area) {
      return false
    }

    if (query.pokemon && !lid.pokemon.some((pokemon) => String(pokemon.number) === query.pokemon)) {
      return false
    }

    if (query.newOnly && !lid.isNew) {
      return false
    }

    if (
      query.accessScores.length > 0 &&
      !query.accessScores.includes(lid.accessibility.score)
    ) {
      return false
    }

    return true
  })
}

function sortLids(
  lids: PokeLidRecord[],
  distanceById: Map<string, number>,
  nearbyMode: boolean,
  userLocation: UserLocation | null,
) {
  if (!nearbyMode || !userLocation) {
    return lids
  }

  return [...lids].sort((left, right) => {
    const leftDistance = distanceById.get(left.manholeNo) ?? Number.POSITIVE_INFINITY
    const rightDistance = distanceById.get(right.manholeNo) ?? Number.POSITIVE_INFINITY

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance
    }

    return left.accessibility.score - right.accessibility.score
  })
}

function buildFilterTags(query: QueryState, nearbyMode: boolean) {
  const tags: string[] = []

  if (nearbyMode) tags.push('現在地から近い順')
  if (query.pref) tags.push(query.pref)
  if (query.area) tags.push(areaLabel(query.area))
  if (query.pokemon) tags.push(`No.${query.pokemon.padStart(4, '0')}`)
  if (query.newOnly) tags.push('新着のみ')

  return tags
}
function buildDistanceMap(lids: PokeLidRecord[], userLocation: UserLocation | null) {
  const distanceById = new Map<string, number>()

  if (!userLocation) {
    return distanceById
  }

  for (const lid of lids) {
    distanceById.set(lid.manholeNo, haversineKm(userLocation, lid))
  }

  return distanceById
}

function toggleAccessScore(
  currentScores: AccessibilityScore[],
  score: AccessibilityScore,
) {
  if (currentScores.includes(score)) {
    return currentScores.filter((entry) => entry !== score)
  }

  return [...currentScores, score].sort((left, right) => left - right)
}

function formatAccessScoreSummary(scores: AccessibilityScore[]) {
  return [...scores].sort((left, right) => left - right).join('・')
}

function requestCurrentLocation({
  onError,
  onSuccess,
}: {
  onError: (status: Extract<LocationStatus, 'unsupported' | 'denied' | 'error'>) => void
  onSuccess: (location: UserLocation) => void
}) {
  if (!navigator.geolocation) {
    onError('unsupported')
    return
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      onSuccess({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      })
    },
    (error) => {
      onError(error.code === 1 ? 'denied' : 'error')
    },
    {
      enableHighAccuracy: false,
      maximumAge: 180000,
      timeout: 8000,
    },
  )
}

function haversineKm(origin: UserLocation, lid: PokeLidRecord) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const deltaLat = toRadians(lid.lat - origin.lat)
  const deltaLng = toRadians(lid.lng - origin.lng)
  const originLat = toRadians(origin.lat)
  const lidLat = toRadians(lid.lat)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(originLat) * Math.cos(lidLat) * Math.sin(deltaLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return earthRadiusKm * c
}

function formatDistance(distanceKm: number | null) {
  if (distanceKm === null || !Number.isFinite(distanceKm)) {
    return null
  }

  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`
  }

  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)} km`
  }

  return `${distanceKm.toFixed(0)} km`
}

function formatPokemonLabel(pokemon: PokemonEntry) {
  return `No.${String(pokemon.number).padStart(4, '0')} ${pokemon.name}`
}

export default App
