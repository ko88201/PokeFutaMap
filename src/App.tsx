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
  WorkspaceLayoutState,
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
  const [desktopPanelOpen, setDesktopPanelOpen] = useState(
    () => window.innerWidth >= DESKTOP_BREAKPOINT,
  )
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
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

        setDesktopPanelOpen(nextIsDesktop)
        setMobilePanelOpen(false)
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
  const workspaceLayout: WorkspaceLayoutState = {
    desktopPanelOpen: isDesktopViewport ? desktopPanelOpen : false,
    mobilePanelOpen: !isDesktopViewport && mobilePanelOpen,
  }
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
    if (isDesktopViewport) {
      setDesktopPanelOpen((open) => !open)
      return
    }

    setMobilePanelOpen((open) => !open)
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
      setMobilePanelOpen(false)
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
        layout={workspaceLayout}
        locateSignal={locateSignal}
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
            active={isDesktopViewport ? desktopPanelOpen : mobilePanelOpen}
            ariaPressed={isDesktopViewport ? desktopPanelOpen : mobilePanelOpen}
            icon={<FilterIcon />}
            onClick={handleMainPanelToggle}
          >
            絞り込み
          </ControlButton>
          <ControlButton
            active={nearbyMode}
            ariaPressed={nearbyMode}
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

      {isDesktopViewport && desktopPanelOpen ? (
        <section className="workspace-panel">
          <div className="workspace-pane workspace-pane-filters">
            <FilterPaneContent
              allPokemon={allPokemon}
              onAccessScoreToggle={(score) => {
                setQueryValue('accessScores', toggleAccessScore(query.accessScores, score))
              }}
              onAreaChange={handleAreaChange}
              onNewOnlyToggle={() => setQueryValue('newOnly', !query.newOnly)}
              onPokemonChange={handlePokemonChange}
              onPrefChange={handlePrefChange}
              prefecturesForSelectedArea={prefecturesForSelectedArea}
              query={query}
              resetFilters={resetFilters}
            />
          </div>

          <div className="workspace-pane workspace-pane-collection">
            <CollectionPaneContent
              activeId={activeLid?.manholeNo ?? null}
              distanceById={distanceById}
              nearbyMode={nearbyMode}
              onSelect={handleListSelect}
              resetFilters={resetFilters}
              userLocation={userLocation}
              visibleLids={visibleLids}
            />
          </div>
        </section>
      ) : null}

      {!isDesktopViewport ? (
        <section className={classNames('sheet', 'main-sheet', mobilePanelOpen && 'open')}>
          <div className="sheet-body">
            <button
              aria-expanded={mobilePanelOpen}
              aria-label={mobilePanelOpen ? 'パネルを折りたたむ' : 'パネルを展開する'}
              className="sheet-handle"
              onClick={handleMainPanelToggle}
              type="button"
            >
              <span />
            </button>

            <div className="sheet-scroll merged-mobile-scroll">
              <div className="merged-mobile-panel">
                <FilterPaneContent
                  allPokemon={allPokemon}
                  onAccessScoreToggle={(score) => {
                    setQueryValue('accessScores', toggleAccessScore(query.accessScores, score))
                  }}
                  onAreaChange={handleAreaChange}
                  onNewOnlyToggle={() => setQueryValue('newOnly', !query.newOnly)}
                  onPokemonChange={handlePokemonChange}
                  onPrefChange={handlePrefChange}
                  prefecturesForSelectedArea={prefecturesForSelectedArea}
                  query={query}
                  resetFilters={resetFilters}
                />
                <CollectionPaneContent
                  activeId={activeLid?.manholeNo ?? null}
                  distanceById={distanceById}
                  nearbyMode={nearbyMode}
                  onSelect={handleListSelect}
                  resetFilters={resetFilters}
                  userLocation={userLocation}
                  visibleLids={visibleLids}
                  scrollable={false}
                />
              </div>
            </div>
          </div>
        </section>
      ) : null}
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

function FilterPaneContent({
  allPokemon,
  onAccessScoreToggle,
  onAreaChange,
  onNewOnlyToggle,
  onPokemonChange,
  onPrefChange,
  prefecturesForSelectedArea,
  query,
  resetFilters,
}: {
  allPokemon: PokemonEntry[]
  onAccessScoreToggle: (score: AccessibilityScore) => void
  onAreaChange: (value: string) => void
  onNewOnlyToggle: () => void
  onPokemonChange: (value: string) => void
  onPrefChange: (value: string) => void
  prefecturesForSelectedArea: string[]
  query: QueryState
  resetFilters: () => void
}) {
  return (
    <div className="filter-pane">
      <section className="filter-pane-section filter-pane-legend">
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
                onClick={() => onAccessScoreToggle(entry.score)}
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
      </section>

      <section className="panel-section filter-pane-form">
        <div className="field-grid">
          <FilterSelect
            label="エリア"
            onChange={onAreaChange}
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
            onChange={onPrefChange}
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
            onChange={onPokemonChange}
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
            onClick={onNewOnlyToggle}
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
  )
}

function CollectionPaneContent({
  activeId,
  distanceById,
  nearbyMode,
  onSelect,
  resetFilters,
  scrollable = true,
  userLocation,
  visibleLids,
}: {
  activeId: string | null
  distanceById: Map<string, number>
  nearbyMode: boolean
  onSelect: (manholeNo: string) => void
  resetFilters: () => void
  scrollable?: boolean
  userLocation: UserLocation | null
  visibleLids: PokeLidRecord[]
}) {
  const content = (
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
            <div className="result-image-wrap">
              <img alt={lid.name} className="result-image" loading="lazy" src={lid.imageUrl} />
            </div>
            <div className="result-score">
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
            No.{lid.manholeNo} {lid.pokemon.map(formatPokemonLabel).join(' · ')}
          </p>
        </button>
      ))}

      {visibleLids.length === 0 ? (
        <div className="empty-state">
          <strong>条件に合うポケふたが見つかりません。</strong>
          <p>条件を少しゆるめると、結果が戻ります。</p>
          <button className="ghost-action" onClick={resetFilters} type="button">
            すべて解除する
          </button>
        </div>
      ) : null}
    </div>
  )

  if (!scrollable) {
    return <div className="collection-inline-list">{content}</div>
  }

  return <div className="collection-scroll">{content}</div>
}

function ControlButton({
  active = false,
  ariaPressed,
  children,
  icon,
  onClick,
}: {
  active?: boolean
  ariaPressed?: boolean
  children: ReactNode
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      aria-pressed={ariaPressed}
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
