import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
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
  collectionOpen: boolean
  locateSignal: number
  mainPanelOpen: boolean
  onSelect: (manholeNo: string | null) => void
  popupContent: ReactNode | null
  resetSignal: number
  userLocation: UserLocation | null
  visibleLids: PokeLidRecord[]
}

export function MapPane({
  activeId,
  activeLid,
  allLids,
  collectionOpen,
  locateSignal,
  mainPanelOpen,
  onSelect,
  popupContent,
  resetSignal,
  userLocation,
  visibleLids,
}: MapPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const lastVisibleKeyRef = useRef('')
  const [isMapReady, setIsMapReady] = useState(false)
  const [popupLayout, setPopupLayout] = useState<{
    anchor: 'above' | 'below'
    left: number
    maxWidth: number
    top: number
  } | null>(null)
  const handleSelect = useEffectEvent((manholeNo: string | null) => {
    onSelect(manholeNo)
  })
  const updatePopupLayout = useEffectEvent(() => {
    const map = mapRef.current
    const container = containerRef.current

    if (!map || !container || !activeLid) {
      setPopupLayout(null)
      return
    }

    const point = map.project([activeLid.lng, activeLid.lat])
    const isDesktop = window.innerWidth >= 980
    const maxWidth = isDesktop ? 336 : Math.min(312, container.clientWidth - 24)
    const safeInset = getPopupSafeInset({
      collectionOpen,
      isDesktop,
      mainPanelOpen,
      popupWidth: maxWidth,
    })
    const minLeft = safeInset.left + maxWidth / 2
    const maxLeft = container.clientWidth - safeInset.right - maxWidth / 2
    const left = Math.min(Math.max(point.x, minLeft), Math.max(minLeft, maxLeft))
    const preferBelow = point.y < (isDesktop ? 220 : 208)
    const top = Math.min(
      Math.max(point.y, safeInset.top),
      container.clientHeight - safeInset.bottom,
    )

    setPopupLayout({
      anchor: preferBelow ? 'below' : 'above',
      left,
      maxWidth,
      top,
    })
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
          map.on('move', () => {
            updatePopupLayout()
          })

          map.on('resize', () => {
            updatePopupLayout()
          })
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

    fitLids(
      map,
      visibleLids.length > 0 ? visibleLids : allLids,
      820,
      { collectionOpen, mainPanelOpen },
    )
    lastVisibleKeyRef.current = nextKey
  }, [activeId, allLids, collectionOpen, isMapReady, mainPanelOpen, visibleLids])

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
      padding: getViewportPadding('focus', { collectionOpen, mainPanelOpen }),
      zoom: 10.4,
    })
  }, [activeLid, collectionOpen, isMapReady, mainPanelOpen])

  useEffect(() => {
    if (!isMapReady) {
      return
    }

    updatePopupLayout()
  }, [activeLid, collectionOpen, isMapReady, mainPanelOpen, popupContent])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady || resetSignal === 0) {
      return
    }

    fitLids(
      map,
      visibleLids.length > 0 ? visibleLids : allLids,
      760,
      { collectionOpen, mainPanelOpen },
      true,
    )
  }, [allLids, collectionOpen, isMapReady, mainPanelOpen, resetSignal, visibleLids])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isMapReady || locateSignal === 0 || !userLocation) {
      return
    }

    map.flyTo({
      center: [userLocation.lng, userLocation.lat],
      duration: 900,
      padding: getViewportPadding('locate', { collectionOpen, mainPanelOpen }),
      zoom: 9.8,
    })
  }, [collectionOpen, isMapReady, locateSignal, mainPanelOpen, userLocation])

  return (
    <section className="map-view" aria-label="ポケふた地図">
      <div className="map-canvas" ref={containerRef} />
      {activeLid && popupContent && popupLayout ? (
        <div
          className={`map-popup-anchor ${popupLayout.anchor === 'below' ? 'anchor-below' : 'anchor-above'}`}
          style={
            {
              '--popup-left': `${popupLayout.left}px`,
              '--popup-max-width': `${popupLayout.maxWidth}px`,
              '--popup-top': `${popupLayout.top}px`,
            } as CSSProperties
          }
        >
          {popupContent}
        </div>
      ) : null}
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

function fitLids(
  map: Map,
  lids: PokeLidRecord[],
  duration: number,
  layout: { collectionOpen: boolean; mainPanelOpen: boolean },
  resetOrientation: boolean = false,
) {
  const bounds = getBoundsForLids(lids)
  if (!bounds) {
    return
  }

  map.fitBounds(bounds, {
    ...(resetOrientation ? { bearing: 0, pitch: 0 } : {}),
    duration,
    maxZoom: 10.8,
    padding: getViewportPadding('fit', layout),
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

function getViewportPadding(
  mode: 'fit' | 'focus' | 'locate',
  layout: { collectionOpen: boolean; mainPanelOpen: boolean },
): PaddingOptions {
  const isDesktop = window.innerWidth >= 980

  if (isDesktop) {
    const mainInset = layout.mainPanelOpen ? 456 : 60
    const collectionInset = layout.collectionOpen ? (layout.mainPanelOpen ? 214 : 316) : 0
    const left = mainInset + collectionInset

    if (mode === 'focus') {
      return { top: 124, right: 48, bottom: 56, left }
    }

    if (mode === 'locate') {
      return { top: 124, right: 48, bottom: 64, left }
    }

    return { top: 124, right: 56, bottom: 56, left: Math.max(180, left - 18) }
  }

  if (mode === 'focus') {
    return { top: 138, right: 24, bottom: 300, left: 24 }
  }

  if (mode === 'locate') {
    return { top: 138, right: 24, bottom: 300, left: 24 }
  }

  return { top: 138, right: 24, bottom: 220, left: 24 }
}

function getPopupSafeInset({
  collectionOpen,
  isDesktop,
  mainPanelOpen,
  popupWidth,
}: {
  collectionOpen: boolean
  isDesktop: boolean
  mainPanelOpen: boolean
  popupWidth: number
}) {
  if (isDesktop) {
    const left =
      (mainPanelOpen ? 426 : 20) + (collectionOpen ? (mainPanelOpen ? 256 : 388) : 0)

    return {
      bottom: 28,
      left,
      right: 24,
      top: 118,
    }
  }

  return {
    bottom: 158,
    left: 12,
    right: 12,
    top: 112 + popupWidth * 0.02,
  }
}
