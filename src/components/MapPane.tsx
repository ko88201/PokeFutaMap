import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import maplibregl, { GeoJSONSource, Map } from 'maplibre-gl'
import type {
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  LngLatBoundsLike,
  PaddingOptions,
} from 'maplibre-gl'
import { loadJapaneseFirstMapStyle } from '../lib/map-style.ts'
import type { PokeLidRecord, UserLocation } from '../types.ts'

const MARKER_COLOR_EXPRESSION: ExpressionSpecification = [
  'match',
  ['get', 'accessibilityScore'],
  1,
  '#2f8f73',
  2,
  '#84ad44',
  3,
  '#d2ad42',
  4,
  '#f07f45',
  5,
  '#c8524d',
  '#f07f45',
]

const EMPTY_COLLECTION: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

const INTERACTIVE_LAYERS = ['pokelid-points', 'pokelid-active'] as const

type MapPaneProps = {
  activeId: string | null
  activeLid: PokeLidRecord | null
  allLids: PokeLidRecord[]
  locateSignal: number
  onSelect: (manholeNo: string | null) => void
  resetSignal: number
  userLocation: UserLocation | null
  visibleLids: PokeLidRecord[]
}

export function MapPane({
  activeId,
  activeLid,
  allLids,
  locateSignal,
  onSelect,
  resetSignal,
  userLocation,
  visibleLids,
}: MapPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const lastVisibleKeyRef = useRef('')
  const [isMapReady, setIsMapReady] = useState(false)
  const handleSelect = useEffectEvent((manholeNo: string | null) => {
    onSelect(manholeNo)
  })

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    let cancelled = false
    let map: Map | null = null

    void loadJapaneseFirstMapStyle()
      .then((style) => {
        if (cancelled || !containerRef.current) {
          return
        }

        map = new maplibregl.Map({
          attributionControl: false,
          center: [137.95, 37.5],
          container: containerRef.current,
          maplibreLogo: false,
          style,
          zoom: 4.5,
        })

        map.addControl(
          new maplibregl.NavigationControl({
            showCompass: true,
            showZoom: false,
            visualizePitch: true,
          }),
          'bottom-right',
        )

        const compassButton = map
          .getContainer()
          .querySelector('.maplibregl-ctrl-compass') as HTMLButtonElement | null
        const compassIcon = compassButton?.querySelector('.maplibregl-ctrl-icon')

        if (compassButton) {
          const controlLabel = '地図の向きと角度を調整'
          compassButton.classList.add('map-gyro-button')
          compassButton.title = controlLabel
          compassButton.setAttribute('aria-label', controlLabel)
        }

        if (compassIcon) {
          compassIcon.classList.add('map-gyro-icon')
        }

        map.on('load', () => {
          if (cancelled || !map) {
            return
          }

          map.addSource('pokelids', {
            type: 'geojson',
            data: EMPTY_COLLECTION,
          } satisfies GeoJSONSourceSpecification)

          map.addSource('user-location', {
            type: 'geojson',
            data: EMPTY_COLLECTION,
          } satisfies GeoJSONSourceSpecification)

          map.addLayer({
            id: 'pokelid-points',
            type: 'circle',
            source: 'pokelids',
            paint: {
              'circle-color': MARKER_COLOR_EXPRESSION,
              'circle-opacity': 0.94,
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                4,
                4.8,
                7,
                6.8,
                10,
                10,
              ],
              'circle-stroke-color': 'rgba(250, 247, 238, 0.92)',
              'circle-stroke-width': 1.2,
            },
          })

          map.addLayer({
            id: 'pokelid-active',
            type: 'circle',
            source: 'pokelids',
            filter: ['==', ['get', 'manholeNo'], '__none__'],
            paint: {
              'circle-color': 'rgba(255,255,255,0)',
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                4,
                11,
                7,
                16,
                10,
                22,
              ],
              'circle-stroke-color': '#132129',
              'circle-stroke-opacity': 0.92,
              'circle-stroke-width': 2.4,
            },
          })

          map.addLayer({
            id: 'user-location-ring',
            type: 'circle',
            source: 'user-location',
            paint: {
              'circle-color': 'rgba(35, 91, 129, 0.12)',
              'circle-radius': 18,
              'circle-stroke-color': 'rgba(19, 33, 41, 0.22)',
              'circle-stroke-width': 1,
            },
          })

          map.addLayer({
            id: 'user-location-dot',
            type: 'circle',
            source: 'user-location',
            paint: {
              'circle-color': '#235b81',
              'circle-radius': 6,
              'circle-stroke-color': '#f7f3e8',
              'circle-stroke-width': 2,
            },
          })

          for (const layerId of INTERACTIVE_LAYERS) {
            map.on('click', layerId, (event) => {
              const manholeNo = event.features?.[0]?.properties?.manholeNo
              if (typeof manholeNo === 'string') {
                handleSelect(manholeNo)
              }
            })

            map.on('mouseenter', layerId, () => {
              map?.getCanvas().style.setProperty('cursor', 'pointer')
            })

            map.on('mouseleave', layerId, () => {
              map?.getCanvas().style.removeProperty('cursor')
            })
          }

          map.on('click', (event) => {
            const features = map?.queryRenderedFeatures(event.point, {
              layers: [...INTERACTIVE_LAYERS],
            })

            if (!features || features.length > 0) {
              return
            }

            handleSelect(null)
          })

          setIsMapReady(true)
        })

        mapRef.current = map
      })
      .catch((error) => {
        console.error('Failed to initialize map', error)
      })

    return () => {
      cancelled = true
      setIsMapReady(false)
      map?.remove()
      mapRef.current = null
      lastVisibleKeyRef.current = ''
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady) {
      return
    }

    const source = map.getSource('pokelids') as GeoJSONSource | undefined
    if (!source) {
      return
    }

    source.setData(buildLidFeatureCollection(visibleLids))

    if (activeId) {
      return
    }

    const nextKey = getVisibleKey(visibleLids)
    if (!nextKey) {
      lastVisibleKeyRef.current = ''
      return
    }

    if (nextKey === lastVisibleKeyRef.current) {
      return
    }

    fitLids(map, visibleLids.length > 0 ? visibleLids : allLids, 820)
    lastVisibleKeyRef.current = nextKey
  }, [activeId, allLids, isMapReady, visibleLids])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady) {
      return
    }

    const source = map.getSource('user-location') as GeoJSONSource | undefined
    if (!source) {
      return
    }

    source.setData(buildUserLocationCollection(userLocation))
  }, [isMapReady, userLocation])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady) {
      return
    }

    map.setFilter('pokelid-active', ['==', ['get', 'manholeNo'], activeId ?? '__none__'])
  }, [activeId, isMapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady || !activeLid) {
      return
    }

    map.flyTo({
      center: [activeLid.lng, activeLid.lat],
      duration: 880,
      padding: getViewportPadding('focus'),
      zoom: 10.4,
    })
  }, [activeLid, isMapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady || resetSignal === 0) {
      return
    }

    fitLids(map, visibleLids.length > 0 ? visibleLids : allLids, 760)
  }, [allLids, isMapReady, resetSignal, visibleLids])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady || locateSignal === 0 || !userLocation) {
      return
    }

    map.flyTo({
      center: [userLocation.lng, userLocation.lat],
      duration: 900,
      padding: getViewportPadding('locate'),
      zoom: 9.8,
    })
  }, [isMapReady, locateSignal, userLocation])

  return (
    <section className="map-view" aria-label="ポケふた地図">
      <div className="map-canvas" ref={containerRef} />
    </section>
  )
}

function buildLidFeatureCollection(lids: PokeLidRecord[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lids.map((lid) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lid.lng, lid.lat],
      },
      properties: {
        accessibilityScore: lid.accessibility.score,
        manholeNo: lid.manholeNo,
      },
    })),
  }
}

function buildUserLocationCollection(userLocation: UserLocation | null): FeatureCollection {
  if (!userLocation) {
    return EMPTY_COLLECTION
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [userLocation.lng, userLocation.lat],
        },
        properties: {},
      },
    ],
  }
}

function fitLids(map: Map, lids: PokeLidRecord[], duration: number) {
  const bounds = getBoundsForLids(lids)
  if (!bounds) {
    return
  }

  map.fitBounds(bounds, {
    duration,
    maxZoom: 10.8,
    padding: getViewportPadding('fit'),
  })
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

function getVisibleKey(lids: PokeLidRecord[]) {
  return lids
    .map((lid) => lid.manholeNo)
    .sort()
    .join('|')
}

function getViewportPadding(mode: 'fit' | 'focus' | 'locate'): PaddingOptions {
  const isDesktop = window.innerWidth >= 980

  if (isDesktop) {
    if (mode === 'focus') {
      return { top: 124, right: 48, bottom: 56, left: 470 }
    }

    if (mode === 'locate') {
      return { top: 124, right: 48, bottom: 64, left: 470 }
    }

    return { top: 124, right: 56, bottom: 56, left: 460 }
  }

  if (mode === 'focus') {
    return { top: 138, right: 24, bottom: 300, left: 24 }
  }

  if (mode === 'locate') {
    return { top: 138, right: 24, bottom: 300, left: 24 }
  }

  return { top: 138, right: 24, bottom: 220, left: 24 }
}
