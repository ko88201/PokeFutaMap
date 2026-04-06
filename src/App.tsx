import { startTransition, useDeferredValue, useEffect, useState } from 'react'
import { MapPane } from './components/MapPane.tsx'
import {
  DEFAULT_LAYERS,
  areaLabel,
  buildGoogleMapsLink,
  classNames,
  formatDistance,
  getInitialQueryState,
  getLayerLabel,
  getPokemonSearchHaystack,
  haversineKilometers,
  queryStateToSearchParams,
  updateLocationSearch,
} from './lib/app-helpers.ts'
import type {
  LayerKey,
  PokeLidRecord,
  QueryState,
  TransitIndex,
  TransitPointFeature,
  TransitRouteFeature,
} from './types.ts'

type DataState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; lids: PokeLidRecord[]; transit: TransitIndex }
  | { status: 'error'; message: string }

type TransitSummary = {
  nearestTrain: TransitPointFeature | null
  nearestBus: TransitPointFeature | null
  nearbyRoutes: TransitRouteFeature[]
}

function App() {
  const [dataState, setDataState] = useState<DataState>({ status: 'loading' })
  const [query, setQuery] = useState<QueryState>(() => getInitialQueryState())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mobilePane, setMobilePane] = useState<'list' | 'map'>('list')
  const deferredSearch = useDeferredValue(query.q)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [lidsResponse, transitResponse] = await Promise.all([
          fetch(`${import.meta.env.BASE_URL}data/pokelids.json`),
          fetch(`${import.meta.env.BASE_URL}data/transit-index.json`),
        ])

        if (!lidsResponse.ok || !transitResponse.ok) {
          throw new Error('Site data was not generated yet.')
        }

        const lids = (await lidsResponse.json()) as PokeLidRecord[]
        const transit = (await transitResponse.json()) as TransitIndex

        if (!cancelled) {
          setDataState({ status: 'ready', lids, transit })
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
    updateLocationSearch(queryStateToSearchParams(query))
  }, [query])

  if (dataState.status === 'loading' || dataState.status === 'idle') {
    return (
      <main className="app-shell">
        <section className="loading-view">
          <p className="eyebrow">PokeFutaMap</p>
          <h1>Loading Poké Lids and transit layers…</h1>
          <p>
            Preparing the build-time dataset, map style, and transport overlays for
            Japan.
          </p>
        </section>
      </main>
    )
  }

  if (dataState.status === 'error') {
    return (
      <main className="app-shell">
        <section className="loading-view">
          <p className="eyebrow">PokeFutaMap</p>
          <h1>Data load failed</h1>
          <p>{dataState.message}</p>
        </section>
      </main>
    )
  }

  const readyData = dataState.status === 'ready' ? dataState : null
  if (!readyData) {
    return null
  }

  const areaOptions = [
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
  const allPokemon = [...new Set<string>(readyData.lids.flatMap((lid) => lid.pokemon))].sort()
  const allPrefectures = [...new Set<string>(readyData.lids.map((lid) => lid.prefName))].sort()
  const visibleLids = filterLids(readyData.lids, { ...query, q: deferredSearch })
  const activeLid =
    visibleLids.find((lid) => lid.manholeNo === activeId) ??
    readyData.lids.find((lid) => lid.manholeNo === activeId) ??
    null
  const activeSummary = activeLid
    ? buildTransitSummary(activeLid, readyData.transit)
    : null

  return (
    <main className="app-shell">
      <section className="hero-shell">
        <div className="hero-copy">
          <p className="eyebrow">PokeFutaMap</p>
          <h1>Find every Poké Lid and the transit around it.</h1>
          <p className="hero-text">
            A split-view explorer for Japan&apos;s Poké Lids with build-time synced
            coordinates, Apple-like cartography, and railway plus bus overlays.
          </p>
        </div>
        <div className="hero-stats">
          <article>
            <strong>{readyData.lids.length}</strong>
            <span>Poké Lids synced</span>
          </article>
          <article>
            <strong>{readyData.transit.stats.totalTransitPoints.toLocaleString()}</strong>
            <span>Transit points indexed</span>
          </article>
          <article>
            <strong>{readyData.transit.stats.totalRailRoutes.toLocaleString()}</strong>
            <span>Rail corridors layered</span>
          </article>
        </div>
      </section>

      <section className="toolbar mobile-only">
        <button
          className={classNames('pill-toggle', mobilePane === 'list' && 'active')}
          onClick={() => setMobilePane('list')}
          type="button"
        >
          List
        </button>
        <button
          className={classNames('pill-toggle', mobilePane === 'map' && 'active')}
          onClick={() => setMobilePane('map')}
          type="button"
        >
          Map
        </button>
      </section>

      <section className="workspace">
        <aside
          className={classNames('sidebar', mobilePane === 'map' && 'mobile-hidden')}
        >
          <section className="panel filter-panel">
            <div className="panel-heading">
              <h2>Explore</h2>
              <p>{visibleLids.length} lids match the current view.</p>
            </div>

            <label className="field">
              <span>Search</span>
              <input
                onChange={(event) => {
                  const nextValue = event.target.value
                  startTransition(() => {
                    setQuery((current) => ({ ...current, q: nextValue }))
                  })
                }}
                placeholder="Search by city or Pokémon"
                type="search"
                value={query.q}
              />
            </label>

            <div className="field-grid">
              <label className="field">
                <span>Prefecture</span>
                <select
                  onChange={(event) => {
                    setQuery((current) => ({ ...current, pref: event.target.value }))
                  }}
                  value={query.pref}
                >
                  <option value="">All prefectures</option>
                  {allPrefectures.map((prefecture) => (
                    <option key={prefecture} value={prefecture}>
                      {prefecture}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Area</span>
                <select
                  onChange={(event) => {
                    setQuery((current) => ({ ...current, area: event.target.value }))
                  }}
                  value={query.area}
                >
                  <option value="">All areas</option>
                  {areaOptions.map(
                    (area) => (
                      <option key={area} value={area}>
                        {areaLabel(area)}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>

            <div className="field-grid">
              <label className="field">
                <span>Pokémon</span>
                <select
                  onChange={(event) => {
                    setQuery((current) => ({
                      ...current,
                      pokemon: event.target.value,
                    }))
                  }}
                  value={query.pokemon}
                >
                  <option value="">All Pokémon</option>
                  {allPokemon.map((pokemon) => (
                    <option key={pokemon} value={pokemon}>
                      {pokemon}
                    </option>
                  ))}
                </select>
              </label>

              <label className="checkbox-field">
                <input
                  checked={query.newOnly}
                  onChange={(event) => {
                    setQuery((current) => ({
                      ...current,
                      newOnly: event.target.checked,
                    }))
                  }}
                  type="checkbox"
                />
                <span>Only newly published lids</span>
              </label>
            </div>

            <div className="layer-group">
              <p>Map layers</p>
              <div className="layer-options">
                {(Object.keys(DEFAULT_LAYERS) as LayerKey[]).map((layer) => (
                  <label className="checkbox-chip" key={layer}>
                    <input
                      checked={query.layers[layer]}
                      onChange={(event) => {
                        setQuery((current) => ({
                          ...current,
                          layers: {
                            ...current.layers,
                            [layer]: event.target.checked,
                          },
                        }))
                      }}
                      type="checkbox"
                    />
                    <span>{getLayerLabel(layer)}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="panel results-panel">
            <div className="panel-heading">
              <h2>Poké Lid list</h2>
              <p>Tap a card to focus the map and transit summary.</p>
            </div>
            <div className="card-list">
              {visibleLids.map((lid) => {
                const isActive = lid.manholeNo === activeLid?.manholeNo

                return (
                  <button
                    className={classNames('lid-card', isActive && 'active')}
                    key={lid.manholeNo}
                    onClick={() => {
                      setActiveId(lid.manholeNo)
                      setMobilePane('map')
                    }}
                    type="button"
                  >
                    <img alt={lid.name} src={lid.imageUrl} />
                    <div className="lid-copy">
                      <div className="lid-title-row">
                        <strong>{lid.name}</strong>
                        {lid.isNew ? <span className="badge">New</span> : null}
                      </div>
                      <span>
                        {lid.prefName} · {areaLabel(lid.area)}
                      </span>
                      <p>{lid.pokemon.join(' · ')}</p>
                    </div>
                  </button>
                )
              })}
              {visibleLids.length === 0 ? (
                <div className="empty-state">
                  <strong>No lids match this filter set.</strong>
                  <p>Try clearing the search, Pokémon, or prefecture filters.</p>
                </div>
              ) : null}
            </div>
          </section>
        </aside>

        <section
          className={classNames('map-column', mobilePane === 'list' && 'mobile-hidden')}
        >
          <section className="panel map-panel">
            <div className="panel-heading">
              <h2>Map view</h2>
              <p>Poké Lids stay prominent while transit layers remain low-contrast.</p>
            </div>
            <MapPane
              activeId={activeLid?.manholeNo ?? null}
              layerVisibility={query.layers}
              lids={readyData.lids}
              onSelect={setActiveId}
              visibleLids={visibleLids}
            />
          </section>

          <section className="panel detail-panel">
            <div className="panel-heading">
              <h2>Selected lid</h2>
              <p>Nearest transit and rail corridors update from the indexed overlays.</p>
            </div>
            {activeLid ? (
              <div className="detail-grid">
                <img alt={activeLid.name} className="detail-image" src={activeLid.imageUrl} />
                <div className="detail-copy">
                  <div className="detail-title">
                    <h3>{activeLid.name}</h3>
                    {activeLid.isNew ? <span className="badge">New</span> : null}
                  </div>
                  <p className="detail-meta">
                    {activeLid.prefName} · {areaLabel(activeLid.area)} · Poké Lid #
                    {activeLid.manholeNo}
                  </p>
                  <p className="detail-pokemon">{activeLid.pokemon.join(' · ')}</p>
                  <div className="detail-links">
                    <a href={activeLid.sourceUrl} rel="noreferrer" target="_blank">
                      Official page
                    </a>
                    <a
                      href={buildGoogleMapsLink(activeLid.lat, activeLid.lng)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open in Google Maps
                    </a>
                  </div>
                </div>
                {activeSummary ? (
                  <div className="summary-grid">
                    <SummaryCard
                      label="Nearest train station"
                      secondary={
                        activeSummary.nearestTrain
                          ? `${formatDistance(
                              haversineKilometers(
                                activeLid.lat,
                                activeLid.lng,
                                activeSummary.nearestTrain.lat,
                                activeSummary.nearestTrain.lng,
                              ),
                            )} away`
                          : 'No nearby station found in dataset'
                      }
                      value={activeSummary.nearestTrain?.name ?? 'Not indexed'}
                    />
                    <SummaryCard
                      label="Nearest bus stop"
                      secondary={
                        activeSummary.nearestBus
                          ? `${formatDistance(
                              haversineKilometers(
                                activeLid.lat,
                                activeLid.lng,
                                activeSummary.nearestBus.lat,
                                activeSummary.nearestBus.lng,
                              ),
                            )} away`
                          : 'No nearby bus stop found in dataset'
                      }
                      value={activeSummary.nearestBus?.name ?? 'Not indexed'}
                    />
                    <SummaryCard
                      label="Rail routes nearby"
                      secondary="Within 10 km of the selected lid"
                      value={
                        activeSummary.nearbyRoutes.length > 0
                          ? activeSummary.nearbyRoutes
                              .slice(0, 3)
                              .map((route) => route.routeName || route.routeRef || route.name)
                              .join(' · ')
                          : 'No named route nearby'
                      }
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state">
                <strong>Select a Poké Lid to inspect transit around it.</strong>
                <p>The map and list stay linked, so either interaction path works.</p>
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  )
}

function SummaryCard({
  label,
  value,
  secondary,
}: {
  label: string
  value: string
  secondary: string
}) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{secondary}</p>
    </article>
  )
}

function filterLids(lids: PokeLidRecord[], query: QueryState) {
  const searchValue = query.q.trim().toLowerCase()

  return lids.filter((lid) => {
    if (query.pref && lid.prefName !== query.pref) return false
    if (query.area && lid.area !== query.area) return false
    if (query.pokemon && !lid.pokemon.includes(query.pokemon)) return false
    if (query.newOnly && !lid.isNew) return false
    if (searchValue && !getPokemonSearchHaystack(lid).includes(searchValue)) return false
    return true
  })
}

function buildTransitSummary(lid: PokeLidRecord, transit: TransitIndex): TransitSummary {
  const trainStations = transit.trainStations
    .map((station) => ({
      feature: station,
      distance: haversineKilometers(lid.lat, lid.lng, station.lat, station.lng),
    }))
    .sort((left, right) => left.distance - right.distance)

  const busFeatures = [...transit.busStops, ...transit.busStations]
    .map((station) => ({
      feature: station,
      distance: haversineKilometers(lid.lat, lid.lng, station.lat, station.lng),
    }))
    .sort((left, right) => left.distance - right.distance)

  const nearbyRoutes = transit.railRoutes
    .map((route) => ({
      route,
      distance: haversineKilometers(
        lid.lat,
        lid.lng,
        route.centroid.lat,
        route.centroid.lng,
      ),
    }))
    .filter((entry) => entry.distance <= 10)
    .sort((left, right) => left.distance - right.distance)
    .map((entry) => entry.route)

  return {
    nearestTrain: trainStations[0]?.feature ?? null,
    nearestBus: busFeatures[0]?.feature ?? null,
    nearbyRoutes,
  }
}

export default App
