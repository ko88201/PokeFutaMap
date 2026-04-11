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
  const [isDesktopViewport, setIsDesktopViewport] = useState(
    () => window.innerWidth >= DESKTOP_BREAKPOINT,
  )
  const [mainPanelOpen, setMainPanelOpen] = useState(
    () => window.innerWidth >= DESKTOP_BREAKPOINT,
  )
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [nearbyMode, setNearbyMode] = useState(() => getInitialNearbyMode())
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle')
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const [locateSignal, setLocateSignal] = useState(0)
  const hasTriedInitialNearbyRef = useRef(false)

  useEffect(() => {
    const handleResize = () => {
      const nextIsDesktop = window.innerWidth >= DESKTOP_BREAKPOINT

      setIsDesktopViewport((current) => {
        if (current === nextIsDesktop) {
          return current
        }

        setMainPanelOpen(nextIsDesktop)
        setCollectionOpen(false)
        return nextIsDesktop
      })
    }

    window.addEventListener('resize', handleResize, { passive: true })
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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
  const prefectureToArea = new Map<string, string>()
  for (const lid of readyLids) {
    if (!prefectureToArea.has(lid.prefName)) {
      prefectureToArea.set(lid.prefName, lid.area)
    }
  }

  const prefecturesForSelectedArea = query.area
    ? allPrefectures.filter((prefecture) => prefectureToArea.get(prefecture) === query.area)
    : allPrefectures
  const distanceById = buildDistanceMap(readyLids, userLocation)
  const filteredLids = filterLids(readyLids, query)
  const visibleLids = sortLids(filteredLids, distanceById, nearbyMode, userLocation)
  const activeLid =
    visibleLids.find((lid) => lid.manholeNo === activeId) ??
    readyLids.find((lid) => lid.manholeNo === activeId) ??
    null
  const activeDistanceKm = activeLid ? distanceById.get(activeLid.manholeNo) ?? null : null

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

  function handleAreaChange(value: string) {
    setQuery((current) => {
      if (!value) {
        return {
          ...current,
          area: '',
          pref: '',
        }
      }

      return {
        ...current,
        area: value,
        pokemon: '',
        pref:
          current.pref && prefectureToArea.get(current.pref) === value ? current.pref : '',
      }
    })
  }

  function handlePrefChange(value: string) {
    setQuery((current) => {
      if (!value) {
        return {
          ...current,
          pref: '',
        }
      }

      return {
        ...current,
        area: prefectureToArea.get(value) ?? '',
        pokemon: '',
        pref: value,
      }
    })
  }

  function handlePokemonChange(value: string) {
    setQuery((current) => ({
      ...current,
      area: '',
      pokemon: value,
      pref: '',
    }))
  }

  function resetFilters() {
    setQuery(DEFAULT_QUERY)
    setNearbyMode(false)
    setActiveId(null)
    setLocationStatus(userLocation ? 'ready' : 'idle')
    setResetSignal((value) => value + 1)
  }

  function handleMainPanelToggle() {
    setMainPanelOpen((open) => {
      const nextOpen = !open
      if (!isDesktopViewport && nextOpen) {
        setCollectionOpen(false)
      }

      return nextOpen
    })
  }

  function handleCollectionToggle() {
    setCollectionOpen((open) => {
      const nextOpen = !open
      if (!isDesktopViewport && nextOpen) {
        setMainPanelOpen(false)
      }

      return nextOpen
    })
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

    if (!isDesktopViewport) {
      setCollectionOpen(false)
    }
  }

  function handleMapSelect(manholeNo: string | null) {
    setActiveId(manholeNo)
  }

  return (
    <main className="app-shell">
      <MapPane
        activeId={activeLid?.manholeNo ?? null}
        activeLid={activeLid}
        allLids={readyLids}
        collectionOpen={collectionOpen}
        locateSignal={locateSignal}
        mainPanelOpen={mainPanelOpen}
        onSelect={handleMapSelect}
        popupContent={
          activeLid ? <MapPopupCard distanceKm={activeDistanceKm} lid={activeLid} /> : null
        }
        resetSignal={resetSignal}
        userLocation={nearbyMode ? userLocation : null}
        visibleLids={visibleLids}
      />

      <FloatingSpotCount count={visibleLids.length} />

      <header className="topbar">
        <div className="topbar-actions">
          <ControlButton
            active={mainPanelOpen}
            icon={<FilterIcon />}
            onClick={handleMainPanelToggle}
          >
            絞り込み
          </ControlButton>
          <ControlButton
            active={collectionOpen}
            icon={<CollectionIcon />}
            onClick={handleCollectionToggle}
          >
            一覧
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

      <section
        className={classNames(
          'sheet',
          'main-sheet',
          mainPanelOpen && 'open',
          collectionOpen && !isDesktopViewport && 'backgrounded',
        )}
      >
        <div className="sheet-body">
          <button
            aria-expanded={mainPanelOpen}
            aria-label={mainPanelOpen ? 'パネルを折りたたむ' : 'パネルを展開する'}
            className="sheet-handle"
            onClick={handleMainPanelToggle}
            type="button"
          >
            <span />
          </button>

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

          <div className="sheet-scroll">
            <section className="panel-section">
              <div className="field-grid">
                <FilterSelect
                  label="エリア"
                  onChange={handleAreaChange}
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
                  label="都道府県"
                  onChange={handlePrefChange}
                  options={[
                    { label: 'すべての都道府県', value: '' },
                    ...prefecturesForSelectedArea.map((prefecture) => ({
                      label: prefecture,
                      value: prefecture,
                    })),
                  ]}
                  value={query.pref}
                />
                <FilterSelect
                  label="ポケモン"
                  onChange={handlePokemonChange}
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
                  <span className="toggle-card-copy">
                    <strong>新着のみ表示</strong>
                  </span>
                  <span className="toggle-indicator" aria-hidden="true" />
                </button>

                <button className="ghost-action" onClick={resetFilters} type="button">
                  条件をクリア
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>

      <CollectionPanel
        activeId={activeLid?.manholeNo ?? null}
        distanceById={distanceById}
        isDesktop={isDesktopViewport}
        nearbyMode={nearbyMode}
        open={collectionOpen}
        onClose={() => setCollectionOpen(false)}
        onSelect={handleListSelect}
        resetFilters={resetFilters}
        userLocation={userLocation}
        visibleLids={visibleLids}
      />
    </main>
  )
}

function FloatingSpotCount({ count }: { count: number }) {
  const formattedCount = new Intl.NumberFormat('en-US').format(count)
  const label = count === 1 ? 'spot' : 'spots'

  return (
    <div
      aria-atomic="true"
      aria-label={`${formattedCount} ${label}`}
      aria-live="polite"
      className="floating-spot-count"
      role="status"
    >
      <span className="floating-spot-count-value">{formattedCount}</span>
      <span className="floating-spot-count-label">{label}</span>
    </div>
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

function CollectionPanel({
  activeId,
  distanceById,
  isDesktop,
  nearbyMode,
  open,
  onClose,
  onSelect,
  resetFilters,
  userLocation,
  visibleLids,
}: {
  activeId: string | null
  distanceById: Map<string, number>
  isDesktop: boolean
  nearbyMode: boolean
  open: boolean
  onClose: () => void
  onSelect: (manholeNo: string) => void
  resetFilters: () => void
  userLocation: UserLocation | null
  visibleLids: PokeLidRecord[]
}) {
  return (
    <section
      aria-hidden={!open}
      className={classNames(
        'collection-panel',
        open && 'open',
        isDesktop ? 'desktop' : 'mobile',
        visibleLids.length === 0 && 'is-empty',
      )}
    >
      <button
        aria-label="一覧を閉じる"
        className="collection-backdrop"
        onClick={onClose}
        type="button"
      />
      <div className="collection-surface">
        <div className="collection-header">
          <div>
            <p className="eyebrow">Collection</p>
            <h3>ポケふた一覧</h3>
          </div>
          <div className="collection-header-actions">
            <span className="collection-count">{visibleLids.length} spots</span>
            <button className="collection-close" onClick={onClose} type="button">
              閉じる
            </button>
          </div>
        </div>

        <p className="collection-subtitle">
          {nearbyMode && userLocation
            ? '現在地から近い順に並んでいます。'
            : '地図と同じ条件で絞り込まれた一覧です。'}
        </p>

        <div className="collection-scroll">
          <div className="result-list">
            {visibleLids.map((lid) => (
              <button
                aria-pressed={lid.manholeNo === activeId}
                className={classNames('result-card', lid.manholeNo === activeId && 'active')}
                key={lid.manholeNo}
                onClick={() => onSelect(lid.manholeNo)}
                type="button"
              >
                <div className="result-card-header">
                  <div className="result-score">
                    <span
                      className="score-badge"
                      style={
                        {
                          '--score-color': getAccessibilityVisual(lid.accessibility.score).color,
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
                <p className="result-pokemon">{lid.pokemon.map(formatPokemonLabel).join(' · ')}</p>
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
                <p>絞り込み条件を少しゆるめると、一覧と地図がすぐに戻ります。</p>
                <button className="ghost-action" onClick={resetFilters} type="button">
                  すべて解除する
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function MapPopupCard({
  distanceKm,
  lid,
}: {
  distanceKm: number | null
  lid: PokeLidRecord
}) {
  const visual = getAccessibilityVisual(lid.accessibility.score)
  const popupActions: Array<{
    ariaLabel: string
    href: string
    icon: ReactNode
    label: string
  }> = []

  if (lid.sourceUrl) {
    popupActions.push({
      ariaLabel: '公式ページを開く',
      href: lid.sourceUrl,
      icon: <ExternalLinkIcon />,
      label: '公式ページ',
    })
  }

  if (lid.googleMapsUrl) {
    popupActions.push({
      ariaLabel: '地図で開く',
      href: lid.googleMapsUrl,
      icon: <MapPinIcon />,
      label: '地図',
    })
  }

  popupActions.push({
    ariaLabel: 'ナビを開始',
    href: buildGoogleNavigationLink(lid.lat, lid.lng),
    icon: <NavigationIcon />,
    label: 'ナビ',
  })

  return (
    <article className="map-popup-card">
      <img alt={lid.name} loading="lazy" src={lid.imageUrl} />
      <div className="map-popup-copy">
        <div className="map-popup-meta">
          <p className="map-popup-kicker">
            {lid.prefName} · {areaLabel(lid.area)} · ポケふた #{lid.manholeNo}
          </p>
          <strong className="map-popup-title">{lid.name}</strong>
          <p className="map-popup-pokemon">
            {lid.pokemon.map(formatPokemonLabel).join(' · ')}
          </p>
        </div>

        <div className="map-popup-badges">
          <span
            className="band-pill map-popup-band"
            style={{ '--score-color': visual.color } as CSSProperties}
          >
            {getAccessibilityBandLabel(lid.accessibility.band)}
          </span>
          {distanceKm !== null ? (
            <span className="distance-pill map-popup-meta-chip">{formatDistance(distanceKm)}</span>
          ) : null}
          {lid.isNew ? <span className="inline-badge map-popup-meta-chip">新着</span> : null}
        </div>

        {lid.accessibility.reasons.length > 0 ? (
          <div className="map-popup-tags">
            {lid.accessibility.reasons.slice(0, 2).map((reason) => (
              <span className="reason-pill map-popup-tag" key={reason}>
                {getAccessibilityReasonLabel(reason)}
              </span>
            ))}
          </div>
        ) : null}

        <div aria-label="スポットの操作" className="map-popup-actions" role="group">
          {popupActions.map((action) => (
            <a
              aria-label={action.ariaLabel}
              className="map-popup-action"
              href={action.href}
              key={action.label}
              rel="noreferrer"
              target="_blank"
              title={action.label}
            >
              {action.icon}
            </a>
          ))}
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

function CollectionIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path
        d="M5 6.5h14M5 12h14M5 17.5h9"
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

function ExternalLinkIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M13 5h6v6m-1-5-8.5 8.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M10 7H8.4A2.4 2.4 0 0 0 6 9.4v6.2A2.4 2.4 0 0 0 8.4 18h6.2a2.4 2.4 0 0 0 2.4-2.4V14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function MapPinIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="M12 21s6-5.22 6-11a6 6 0 1 0-12 0c0 5.78 6 11 6 11Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M12 12.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function NavigationIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="m13.8 10.2 4.6-4.6-6 15-2.2-6.2L4 12.2l15-6-4.6 4.6-.6-.6Z"
        fill="currentColor"
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
