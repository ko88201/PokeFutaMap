import { useEffect, useRef, useState, type CSSProperties } from 'react'
import maplibregl, { GeoJSONSource, Map } from 'maplibre-gl'
import type { ExpressionSpecification, LngLatBoundsLike } from 'maplibre-gl'
import {
  ACCESSIBILITY_VISUALS,
  getAccessibilityBandLabel,
  getAccessibilityReasonLabel,
  getAccessibilityVisual,
} from '../lib/accessibility.ts'
import {
  buildGoogleMapsLink,
  buildGoogleNavigationLink,
} from '../lib/app-helpers.ts'
import { loadJapaneseFirstMapStyle } from '../lib/map-style.ts'
import type { PokeLidRecord } from '../types.ts'

const MARKER_COLOR_EXPRESSION: ExpressionSpecification = [
  'match',
  ['get', 'accessibilityScore'],
  1,
  '#46a06d',
  2,
  '#8db548',
  3,
  '#d2ad42',
  4,
  '#f07f45',
  5,
  '#d85b52',
  '#f07f45',
]

const INTERACTIVE_LAYERS = [
  'pokelid-fill',
  'pokelid-score-label',
  'pokelid-score-active',
] as const

type MapPaneProps = {
  activeId: string | null
  lids: PokeLidRecord[]
  onSelect: (manholeNo: string | null) => void
  visibleLids: PokeLidRecord[]
}

export function MapPane({
  activeId,
  lids,
  onSelect,
  visibleLids,
}: MapPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const hasFramedRef = useRef(false)
  const [isMapReady, setIsMapReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    let cancelled = false
    let map: Map | null = null

    void loadJapaneseFirstMapStyle().then((style) => {
      if (cancelled || !containerRef.current) {
        return
      }

      map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: [137.95, 37.5],
        zoom: 4.5,
      })

      map.addControl(new maplibregl.NavigationControl(), 'top-right')

      map.on('load', () => {
        if (cancelled) {
          return
        }

        map?.addSource('pokelids', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })

        map?.addLayer({
          id: 'pokelid-outline',
          type: 'circle',
          source: 'pokelids',
          paint: {
            'circle-radius': 7,
            'circle-color': '#ffffff',
            'circle-opacity': 0.96,
          },
        })

        map?.addLayer({
          id: 'pokelid-fill',
          type: 'circle',
          source: 'pokelids',
          paint: {
            'circle-radius': 4.6,
            'circle-color': MARKER_COLOR_EXPRESSION,
            'circle-stroke-color': '#8c3517',
            'circle-stroke-width': 1.2,
          },
        })

        map?.addLayer({
          id: 'pokelid-score-label',
          type: 'symbol',
          source: 'pokelids',
          minzoom: 8.5,
          layout: {
            'text-field': ['to-string', ['get', 'accessibilityScore']],
            'text-size': 10.5,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': '#1d2b33',
            'text-halo-color': 'rgba(255, 255, 255, 0.9)',
            'text-halo-width': 1.6,
          },
        })

        map?.addLayer({
          id: 'pokelid-score-active',
          type: 'symbol',
          source: 'pokelids',
          filter: ['==', ['get', 'manholeNo'], ''],
          layout: {
            'text-field': ['to-string', ['get', 'accessibilityScore']],
            'text-size': 12,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': '#1d2b33',
            'text-halo-color': 'rgba(255, 255, 255, 0.98)',
            'text-halo-width': 2,
          },
        })

        for (const layerId of INTERACTIVE_LAYERS) {
          map?.on('click', layerId, (event) => {
            const manholeNo = event.features?.[0]?.properties?.manholeNo
            if (typeof manholeNo === 'string') {
              onSelect(manholeNo)
            }
          })

          map?.on('mouseenter', layerId, () => {
            map?.getCanvas().style.setProperty('cursor', 'pointer')
          })

          map?.on('mouseleave', layerId, () => {
            map?.getCanvas().style.removeProperty('cursor')
          })
        }

        map?.on('click', (event) => {
          const features = map?.queryRenderedFeatures(event.point, {
            layers: [...INTERACTIVE_LAYERS],
          })

          if (!features || features.length > 0) {
            return
          }

          onSelect(null)
        })

        setIsMapReady(true)
      })

      mapRef.current = map
    })

    return () => {
      cancelled = true
      setIsMapReady(false)
      popupRef.current?.remove()
      popupRef.current = null
      hasFramedRef.current = false
      map?.remove()
      mapRef.current = null
    }
  }, [onSelect])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady) {
      return
    }

    const source = map.getSource('pokelids') as GeoJSONSource | undefined
    if (!source) {
      return
    }

    source.setData({
      type: 'FeatureCollection',
      features: visibleLids.map((lid) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lid.lng, lid.lat],
        },
        properties: {
          accessibilityScore: lid.accessibility.score,
          accessibilityBand: lid.accessibility.band,
          manholeNo: lid.manholeNo,
          name: lid.name,
        },
      })),
    })

    const activeStillVisible = activeId
      ? visibleLids.some((lid) => lid.manholeNo === activeId)
      : false

    if (activeStillVisible) {
      return
    }

    if (visibleLids.length === 0) {
      hasFramedRef.current = false
      return
    }

    if (!activeId || !hasFramedRef.current) {
      const bounds = getBoundsForLids(visibleLids)
      if (bounds) {
        map.fitBounds(bounds, { padding: 48, duration: 800 })
        hasFramedRef.current = true
      }
    }
  }, [activeId, isMapReady, visibleLids])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady) {
      return
    }

    map.setPaintProperty('pokelid-outline', 'circle-radius', [
      'case',
      ['==', ['get', 'manholeNo'], activeId ?? ''],
      10,
      7,
    ])

    map.setPaintProperty('pokelid-fill', 'circle-radius', [
      'case',
      ['==', ['get', 'manholeNo'], activeId ?? ''],
      7.2,
      4.6,
    ])

    map.setFilter('pokelid-score-active', [
      '==',
      ['get', 'manholeNo'],
      activeId ?? '',
    ])
  }, [activeId, isMapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady) {
      return
    }

    popupRef.current?.remove()
    popupRef.current = null

    const lid = lids.find((entry) => entry.manholeNo === activeId)
    if (!lid) {
      return
    }

    map.flyTo({
      center: [lid.lng, lid.lat],
      zoom: 10.3,
      duration: 900,
    })
    hasFramedRef.current = true

    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 16,
      maxWidth: '320px',
    })
      .setLngLat([lid.lng, lid.lat])
      .setHTML(buildPopupHtml(lid))
      .addTo(map)
  }, [activeId, isMapReady, lids])

  return (
    <div className="map-frame">
      <div className="map-canvas" ref={containerRef} />
      <aside className="map-legend" aria-label="可達性難度の凡例">
        <p className="map-legend-kicker">Access</p>
        <strong>可達性の目安</strong>
        <p>
          駅・バス・港・空港に加えて、国際線空港・新幹線・主要都市からの入りやすさも 1 〜 5 に反映します。
        </p>
        <div className="map-legend-scale">
          {ACCESSIBILITY_VISUALS.map((entry) => (
            <div className="map-legend-item" key={entry.score}>
              <span
                className="map-legend-dot"
                style={{ '--score-color': entry.color } as CSSProperties}
              >
                {entry.score}
              </span>
              <span>{entry.label}</span>
            </div>
          ))}
        </div>
        <small>数値は選択中か、地図を拡大したときに表示されます。</small>
      </aside>
    </div>
  )
}

function buildPopupHtml(lid: PokeLidRecord) {
  const visual = getAccessibilityVisual(lid.accessibility.score)
  const reasonTags = lid.accessibility.reasons
    .map(
      (reason) =>
        `<span class="map-popup-tag">${getAccessibilityReasonLabel(reason)}</span>`,
    )
    .join('')

  return `
        <article class="map-popup">
          <img src="${lid.imageUrl}" alt="${lid.name}" />
          <div class="map-popup-copy">
            <p class="map-popup-meta">${lid.prefName}</p>
            <strong>${lid.name}</strong>
            <div class="map-popup-accessibility">
              <span class="map-popup-score" style="--score-color: ${visual.color}">
                難度 ${lid.accessibility.score} / 5
              </span>
              <span class="map-popup-band">${getAccessibilityBandLabel(lid.accessibility.band)}</span>
            </div>
            ${reasonTags ? `<div class="map-popup-reasons">${reasonTags}</div>` : ''}
            <div class="map-popup-actions">
              <a class="popup-action" href="${buildGoogleMapsLink(lid.lat, lid.lng)}" target="_blank" rel="noreferrer">Googleマップで開く</a>
              <a class="popup-action popup-action-primary" href="${buildGoogleNavigationLink(lid.lat, lid.lng)}" target="_blank" rel="noreferrer">Googleでナビ</a>
            </div>
          </div>
        </article>
      `
}

function getBoundsForLids(lids: PokeLidRecord[]): LngLatBoundsLike | null {
  if (lids.length === 0) {
    return null
  }

  let west = lids[0].lng
  let east = lids[0].lng
  let south = lids[0].lat
  let north = lids[0].lat

  for (const lid of lids) {
    west = Math.min(west, lid.lng)
    east = Math.max(east, lid.lng)
    south = Math.min(south, lid.lat)
    north = Math.max(north, lid.lat)
  }

  return [
    [west, south],
    [east, north],
  ]
}
