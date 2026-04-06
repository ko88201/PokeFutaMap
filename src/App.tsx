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
          <h1>ポケふたデータを読み込み中…</h1>
          <p>地図と交通レイヤーを準備しています。</p>
        </section>
      </main>
    )
  }

  if (dataState.status === 'error') {
    return (
      <main className="app-shell">
        <section className="loading-view">
          <p className="eyebrow">PokeFutaMap</p>
          <h1>データの読み込みに失敗しました</h1>
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
      <section className="toolbar mobile-only">
        <button
          className={classNames('pill-toggle', mobilePane === 'list' && 'active')}
          onClick={() => setMobilePane('list')}
          type="button"
        >
          一覧
        </button>
        <button
          className={classNames('pill-toggle', mobilePane === 'map' && 'active')}
          onClick={() => setMobilePane('map')}
          type="button"
        >
          地図
        </button>
      </section>

      <section className="workspace">
        <aside
          className={classNames('sidebar', mobilePane === 'map' && 'mobile-hidden')}
        >
          <section className="panel filter-panel">
            <div className="panel-heading">
              <h2>ポケふたを探す</h2>
              <p>
                {visibleLids.length}件表示中 / 全{readyData.lids.length}件
              </p>
            </div>

            <label className="field">
              <span>検索</span>
              <input
                onChange={(event) => {
                  const nextValue = event.target.value
                  startTransition(() => {
                    setQuery((current) => ({ ...current, q: nextValue }))
                  })
                }}
                placeholder="地名やポケモン名で検索"
                type="search"
                value={query.q}
              />
            </label>

            <div className="field-grid">
              <label className="field">
                <span>都道府県</span>
                <select
                  onChange={(event) => {
                    setQuery((current) => ({ ...current, pref: event.target.value }))
                  }}
                  value={query.pref}
                >
                  <option value="">すべての都道府県</option>
                  {allPrefectures.map((prefecture) => (
                    <option key={prefecture} value={prefecture}>
                      {prefecture}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>エリア</span>
                <select
                  onChange={(event) => {
                    setQuery((current) => ({ ...current, area: event.target.value }))
                  }}
                  value={query.area}
                >
                  <option value="">すべてのエリア</option>
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
                <span>ポケモン</span>
                <select
                  onChange={(event) => {
                    setQuery((current) => ({
                      ...current,
                      pokemon: event.target.value,
                    }))
                  }}
                  value={query.pokemon}
                >
                  <option value="">すべてのポケモン</option>
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
                <span>新着のみ表示</span>
              </label>
            </div>

            <div className="layer-group">
              <p>表示レイヤー</p>
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
              <h2>ポケふた一覧</h2>
              <p>カードを押すと地図と詳細が連動します。</p>
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
                        {lid.isNew ? <span className="badge">新着</span> : null}
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
                  <strong>条件に合うポケふたが見つかりません。</strong>
                  <p>検索語や絞り込み条件を少し減らしてみてください。</p>
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
              <h2>地図</h2>
              <p>ポケふたを主役にしつつ、交通情報を重ねて見られます。</p>
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
              <h2>選択中のポケふた</h2>
              <p>近くの駅やバス停、周辺路線を確認できます。</p>
            </div>
            {activeLid ? (
              <div className="detail-grid">
                <img alt={activeLid.name} className="detail-image" src={activeLid.imageUrl} />
                <div className="detail-copy">
                  <div className="detail-title">
                    <h3>{activeLid.name}</h3>
                    {activeLid.isNew ? <span className="badge">新着</span> : null}
                  </div>
                  <p className="detail-meta">
                    {activeLid.prefName} · {areaLabel(activeLid.area)} · ポケふた #
                    {activeLid.manholeNo}
                  </p>
                  <p className="detail-pokemon">{activeLid.pokemon.join(' · ')}</p>
                  <div className="detail-links">
                    <a href={activeLid.sourceUrl} rel="noreferrer" target="_blank">
                      公式ページ
                    </a>
                    <a
                      href={buildGoogleMapsLink(activeLid.lat, activeLid.lng)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Googleマップで開く
                    </a>
                  </div>
                </div>
                {activeSummary ? (
                  <div className="summary-grid">
                    <SummaryCard
                      label="最寄り駅"
                      secondary={
                        activeSummary.nearestTrain
                          ? `${formatDistance(
                              haversineKilometers(
                                activeLid.lat,
                                activeLid.lng,
                                activeSummary.nearestTrain.lat,
                                activeSummary.nearestTrain.lng,
                              ),
                            )}`
                          : '近くの駅データが見つかりません'
                      }
                      value={activeSummary.nearestTrain?.name ?? '未収録'}
                    />
                    <SummaryCard
                      label="最寄りバス停"
                      secondary={
                        activeSummary.nearestBus
                          ? `${formatDistance(
                              haversineKilometers(
                                activeLid.lat,
                                activeLid.lng,
                                activeSummary.nearestBus.lat,
                                activeSummary.nearestBus.lng,
                              ),
                            )}`
                          : '近くのバス停データが見つかりません'
                      }
                      value={activeSummary.nearestBus?.name ?? '未収録'}
                    />
                    <SummaryCard
                      label="周辺の鉄道路線"
                      secondary="選択地点から10km圏内"
                      value={
                        activeSummary.nearbyRoutes.length > 0
                          ? activeSummary.nearbyRoutes
                              .slice(0, 3)
                              .map((route) => route.routeName || route.routeRef || route.name)
                              .join(' · ')
                          : '周辺に路線データなし'
                      }
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state">
                <strong>ポケふたを選ぶと詳細と交通情報を表示します。</strong>
                <p>一覧でも地図でも、どちらからでも選択できます。</p>
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
