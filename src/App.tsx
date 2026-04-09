import { useEffect, useState } from 'react'
import { MapPane } from './components/MapPane.tsx'
import {
  areaLabel,
  buildGoogleMapsLink,
  buildGoogleNavigationLink,
  classNames,
  getInitialQueryState,
  queryStateToSearchParams,
  updateLocationSearch,
} from './lib/app-helpers.ts'
import type { PokemonEntry, PokeLidRecord, QueryState } from './types.ts'

type DataState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; lids: PokeLidRecord[] }
  | { status: 'error'; message: string }

function App() {
  const [dataState, setDataState] = useState<DataState>({ status: 'loading' })
  const [query, setQuery] = useState<QueryState>(() => getInitialQueryState())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mobilePane, setMobilePane] = useState<'list' | 'map'>('list')

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
    updateLocationSearch(queryStateToSearchParams(query))
  }, [query])

  if (dataState.status === 'loading' || dataState.status === 'idle') {
    return (
      <main className="app-shell">
        <section className="loading-view">
          <p className="eyebrow">PokeFutaMap</p>
          <h1>ポケふたデータを読み込み中…</h1>
          <p>地図を準備しています。</p>
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
  const pokemonMap = new Map<number, PokemonEntry>()
  for (const lid of readyData.lids) {
    for (const pokemon of lid.pokemon) {
      pokemonMap.set(pokemon.number, pokemon)
    }
  }
  const allPokemon = [...pokemonMap.values()].sort(
    (left, right) => left.number - right.number,
  )
  const allPrefectures = [...new Set<string>(readyData.lids.map((lid) => lid.prefName))].sort()
  const visibleLids = filterLids(readyData.lids, query)
  const activeLid =
    visibleLids.find((lid) => lid.manholeNo === activeId) ??
    readyData.lids.find((lid) => lid.manholeNo === activeId) ??
    null

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

            <div className="field-grid">
              <label className="field">
                <span>都道府県</span>
                <select
                  onChange={(event) => {
                    setQuery((current) => ({
                      ...current,
                      pref: event.target.value,
                      area: '',
                      pokemon: '',
                    }))
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
                    setQuery((current) => ({
                      ...current,
                      pref: '',
                      area: event.target.value,
                      pokemon: '',
                    }))
                  }}
                  value={query.area}
                >
                  <option value="">すべてのエリア</option>
                  {areaOptions.map((area) => (
                    <option key={area} value={area}>
                      {areaLabel(area)}
                    </option>
                  ))}
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
                      pref: '',
                      area: '',
                      pokemon: event.target.value,
                    }))
                  }}
                  value={query.pokemon}
                >
                  <option value="">すべてのポケモン</option>
                  {allPokemon.map((pokemon) => (
                    <option key={pokemon.number} value={String(pokemon.number)}>
                      {formatPokemonLabel(pokemon)}
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
                      <p>{lid.pokemon.map(formatPokemonLabel).join(' · ')}</p>
                    </div>
                  </button>
                )
              })}
              {visibleLids.length === 0 ? (
                <div className="empty-state">
                  <strong>条件に合うポケふたが見つかりません。</strong>
                  <p>絞り込み条件を少し減らしてみてください。</p>
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
              <p>日本各地のポケふたの位置を地図で確認できます。</p>
            </div>
            <MapPane
              activeId={activeLid?.manholeNo ?? null}
              lids={readyData.lids}
              onSelect={setActiveId}
              visibleLids={visibleLids}
            />
          </section>

          <section className="panel detail-panel">
            <div className="panel-heading">
              <h2>選択中のポケふた</h2>
              <p>選択したポケふたの画像と場所を確認できます。</p>
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
                  <p className="detail-pokemon">
                    {activeLid.pokemon.map(formatPokemonLabel).join(' · ')}
                  </p>
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
                    <a
                      href={buildGoogleNavigationLink(activeLid.lat, activeLid.lng)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Googleでナビ
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <strong>ポケふたを選ぶと詳細を表示します。</strong>
                <p>一覧でも地図でも、どちらからでも選択できます。</p>
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  )
}

function filterLids(lids: PokeLidRecord[], query: QueryState) {
  return lids.filter((lid) => {
    if (query.pref && lid.prefName !== query.pref) return false
    if (query.area && lid.area !== query.area) return false
    if (query.pokemon && !lid.pokemon.some((pokemon) => String(pokemon.number) === query.pokemon)) {
      return false
    }
    if (query.newOnly && !lid.isNew) return false
    return true
  })
}

function formatPokemonLabel(pokemon: PokemonEntry) {
  return `No.${String(pokemon.number).padStart(4, '0')} ${pokemon.name}`
}

export default App
