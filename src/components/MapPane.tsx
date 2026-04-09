import { useEffect, useRef, useState } from 'react'
import maplibregl, { GeoJSONSource, Map } from 'maplibre-gl'
import type { LngLatBoundsLike } from 'maplibre-gl'
import {
  buildGoogleMapsLink,
  buildGoogleNavigationLink,
} from '../lib/app-helpers.ts'
import { loadJapaneseFirstMapStyle } from '../lib/map-style.ts'
import type { PokeLidRecord } from '../types.ts'

type MapPaneProps = {
  activeId: string | null
  lids: PokeLidRecord[]
  onSelect: (manholeNo: string) => void
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
            'circle-color': '#f07f45',
            'circle-stroke-color': '#8c3517',
            'circle-stroke-width': 1.2,
          },
        })

        map?.on('click', 'pokelid-fill', (event) => {
          const manholeNo = event.features?.[0]?.properties?.manholeNo
          if (typeof manholeNo === 'string') {
            onSelect(manholeNo)
          }
        })

        map?.on('mouseenter', 'pokelid-fill', () => {
          map?.getCanvas().style.setProperty('cursor', 'pointer')
        })

        map?.on('mouseleave', 'pokelid-fill', () => {
          map?.getCanvas().style.removeProperty('cursor')
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
      maxWidth: '290px',
    })
      .setLngLat([lid.lng, lid.lat])
      .setHTML(`
        <article class="map-popup">
          <img src="${lid.imageUrl}" alt="${lid.name}" />
          <div>
            <strong>${lid.name}</strong>
            <p>${lid.prefName}</p>
            <a href="${buildGoogleMapsLink(lid.lat, lid.lng)}" target="_blank" rel="noreferrer">Googleマップで開く</a>
            <a href="${buildGoogleNavigationLink(lid.lat, lid.lng)}" target="_blank" rel="noreferrer">Googleでナビ</a>
          </div>
        </article>
      `)
      .addTo(map)
  }, [activeId, isMapReady, lids])

  return <div className="map-canvas" ref={containerRef} />
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
