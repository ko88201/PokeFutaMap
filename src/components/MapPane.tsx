import { useEffect, useRef } from 'react'
import maplibregl, { GeoJSONSource, Map } from 'maplibre-gl'
import type { LngLatBoundsLike } from 'maplibre-gl'
import { PMTiles, Protocol } from 'pmtiles'
import { buildGoogleMapsLink } from '../lib/app-helpers.ts'
import type { LayerVisibilityState, PokeLidRecord } from '../types.ts'

type MapPaneProps = {
  activeId: string | null
  layerVisibility: LayerVisibilityState
  lids: PokeLidRecord[]
  onSelect: (manholeNo: string) => void
  visibleLids: PokeLidRecord[]
}

const protocol = new Protocol()
let protocolRegistered = false

function ensurePmtilesProtocol() {
  if (!protocolRegistered) {
    maplibregl.addProtocol('pmtiles', protocol.tile)
    protocolRegistered = true
  }
}

export function MapPane({
  activeId,
  layerVisibility,
  lids,
  onSelect,
  visibleLids,
}: MapPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    ensurePmtilesProtocol()
    protocol.add(
      new PMTiles(new URL(`${import.meta.env.BASE_URL}data/transit.pmtiles`, window.location.href).toString()),
    )

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          carto: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          },
        },
        layers: [{ id: 'carto-base', type: 'raster', source: 'carto' }],
      },
      center: [137.95, 37.5],
      zoom: 4.5,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource('pokelids', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addSource('transit', {
        type: 'vector',
        url: `pmtiles://${new URL(`${import.meta.env.BASE_URL}data/transit.pmtiles`, window.location.href).toString()}`,
      })

      map.addLayer({
        id: 'rail-routes',
        type: 'line',
        source: 'transit',
        'source-layer': 'rail_routes',
        paint: {
          'line-color': '#65818a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.7, 10, 2.1],
          'line-opacity': 0.38,
        },
      })

      map.addLayer({
        id: 'train-stations',
        type: 'circle',
        source: 'transit',
        'source-layer': 'train_stations',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 11, 5.4],
          'circle-color': '#234354',
          'circle-stroke-color': '#f5f7f4',
          'circle-stroke-width': 1.1,
        },
      })

      map.addLayer({
        id: 'bus-stops',
        type: 'circle',
        source: 'transit',
        'source-layer': 'bus_stops',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.8, 11, 4],
          'circle-color': '#7ea38b',
          'circle-opacity': 0.64,
        },
      })

      map.addLayer({
        id: 'bus-stations',
        type: 'circle',
        source: 'transit',
        'source-layer': 'bus_stations',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 11, 6],
          'circle-color': '#426c4a',
          'circle-stroke-color': '#f5f7f4',
          'circle-stroke-width': 1,
        },
      })

      map.addLayer({
        id: 'pokelid-outline',
        type: 'circle',
        source: 'pokelids',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'manholeNo'], activeId ?? ''], 10, 7],
          'circle-color': '#ffffff',
          'circle-opacity': 0.96,
        },
      })

      map.addLayer({
        id: 'pokelid-fill',
        type: 'circle',
        source: 'pokelids',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'manholeNo'], activeId ?? ''], 7.2, 4.6],
          'circle-color': '#f07f45',
          'circle-stroke-color': '#8c3517',
          'circle-stroke-width': 1.2,
        },
      })

      map.on('click', 'pokelid-fill', (event) => {
        const manholeNo = event.features?.[0]?.properties?.manholeNo
        if (typeof manholeNo === 'string') {
          onSelect(manholeNo)
        }
      })

      map.on('mouseenter', 'pokelid-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })

      map.on('mouseleave', 'pokelid-fill', () => {
        map.getCanvas().style.cursor = ''
      })
    })

    mapRef.current = map

    return () => {
      popupRef.current?.remove()
      popupRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [activeId, onSelect])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) {
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

    if (!activeId && visibleLids.length > 0) {
      const bounds = getBoundsForLids(visibleLids)
      if (bounds) {
        map.fitBounds(bounds, { padding: 48, duration: 800 })
      }
    }
  }, [activeId, visibleLids])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) {
      return
    }

    map.setLayoutProperty('rail-routes', 'visibility', layerVisibility.railRoutes ? 'visible' : 'none')
    map.setLayoutProperty('train-stations', 'visibility', layerVisibility.trainStations ? 'visible' : 'none')
    map.setLayoutProperty('bus-stops', 'visibility', layerVisibility.busStops ? 'visible' : 'none')
    map.setLayoutProperty('bus-stations', 'visibility', layerVisibility.busStations ? 'visible' : 'none')
    map.setLayoutProperty('pokelid-outline', 'visibility', layerVisibility.pokeLids ? 'visible' : 'none')
    map.setLayoutProperty('pokelid-fill', 'visibility', layerVisibility.pokeLids ? 'visible' : 'none')
  }, [layerVisibility])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) {
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
          </div>
        </article>
      `)
      .addTo(map)
  }, [activeId, lids])

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
