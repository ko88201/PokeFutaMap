import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'

const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

type StyleLayer = StyleSpecification['layers'][number]
type TextSymbolLayer = StyleLayer & {
  type: 'symbol'
  layout: Record<string, unknown>
  paint?: Record<string, unknown>
}

const COUNTRY_LAYER_IDS = new Set([
  'label_country_1',
  'label_country_2',
  'label_country_3',
])

const PLACE_LAYER_IDS = new Set([
  'label_city',
  'label_city_capital',
  'label_state',
  'label_town',
  'label_village',
  'label_other',
])

const POINT_PLACE_LAYER_IDS = new Set([
  'label_city',
  'label_city_capital',
  'label_town',
  'label_village',
])

const BOLD_LAYER_IDS = new Set([
  'label_country_1',
  'label_country_2',
  'label_country_3',
  'label_city_capital',
])

const JAPAN_REGION = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [[
        [129.5, 30.8],
        [131.9, 30.8],
        [131.9, 34.1],
        [129.5, 34.1],
        [129.5, 30.8],
      ]],
      [[
        [130.2, 33.0],
        [142.6, 33.0],
        [142.6, 41.9],
        [130.2, 41.9],
        [130.2, 33.0],
      ]],
      [[
        [139.0, 41.0],
        [146.3, 41.0],
        [146.3, 45.9],
        [139.0, 45.9],
        [139.0, 41.0],
      ]],
      [[
        [122.5, 23.0],
        [128.8, 23.0],
        [128.8, 28.7],
        [122.5, 28.7],
        [122.5, 23.0],
      ]],
      [[
        [141.0, 24.0],
        [145.5, 24.0],
        [145.5, 28.5],
        [141.0, 28.5],
        [141.0, 24.0],
      ]],
    ],
  },
}

const TAIWAN_REGION = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [119.7, 21.6],
      [122.2, 21.6],
      [122.2, 25.6],
      [119.7, 25.6],
      [119.7, 21.6],
    ]],
  },
}

const LABEL_NAME_KEY = [
  'downcase',
  ['to-string', ['coalesce', ['get', 'name_en'], ['get', 'name'], '']],
] as unknown as ExpressionSpecification

const IS_JAPAN_LABEL = [
  'any',
  ['==', LABEL_NAME_KEY, 'japan'],
  ['within', JAPAN_REGION],
] as unknown as ExpressionSpecification

const IS_TAIWAN_LABEL = [
  'any',
  ['==', LABEL_NAME_KEY, 'taiwan'],
  ['within', TAIWAN_REGION],
] as unknown as ExpressionSpecification

let stylePromise: Promise<StyleSpecification> | null = null

export function loadJapaneseFirstMapStyle() {
  if (!stylePromise) {
    stylePromise = fetch(BASE_STYLE_URL)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load map style: ${response.status}`)
        }

        const style = (await response.json()) as StyleSpecification
        return localizeStyle(style)
      })
  }

  return stylePromise
}

function localizeStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const localizedLayer = localizeSymbolText(layer)

      if (!isTextSymbolLayer(localizedLayer)) {
        return localizedLayer
      }

      if (COUNTRY_LAYER_IDS.has(localizedLayer.id)) {
        return styleCountryLayer(localizedLayer)
      }

      if (PLACE_LAYER_IDS.has(localizedLayer.id)) {
        return stylePlaceLayer(localizedLayer)
      }

      return localizedLayer
    }),
  }
}

function isTextSymbolLayer(layer: StyleLayer): layer is TextSymbolLayer {
  return layer.type === 'symbol' && !!layer.layout && 'text-field' in layer.layout
}

function localizeSymbolText(layer: StyleLayer): StyleLayer {
  if (!isTextSymbolLayer(layer)) {
    return layer
  }

  const separator = layer.layout['symbol-placement'] === 'line' ? ' ' : '\n'

  return {
    ...layer,
    layout: {
      ...layer.layout,
      'text-field': buildLocalizedLabel(separator),
    },
  } as StyleLayer
}

function buildLocalizedLabel(separator: string): ExpressionSpecification {
  return [
    'let',
    'primary',
    ['coalesce', ['get', 'name:ja'], ['get', 'name:nonlatin'], ['get', 'name']],
    'secondary',
    ['coalesce', ['get', 'name_en'], ['get', 'name:latin']],
    [
      'case',
      [
        'all',
        ['!=', ['var', 'primary'], null],
        ['!=', ['var', 'secondary'], null],
        ['!=', ['var', 'primary'], ['var', 'secondary']],
      ],
      [
        'concat',
        ['to-string', ['var', 'primary']],
        separator,
        ['to-string', ['var', 'secondary']],
      ],
      ['coalesce', ['var', 'primary'], ['var', 'secondary'], ''],
    ],
  ]
}

function styleCountryLayer(layer: TextSymbolLayer): StyleLayer {
  return {
    ...layer,
    layout: {
      ...layer.layout,
      'text-font': buildPriorityFontExpression('Noto Sans Bold'),
      'text-size': scaleTextSizeValue(
        layer.layout['text-size'],
        1,
        0.9,
        0.72,
      ),
    },
    paint: {
      ...layer.paint,
      'text-color': buildPriorityValueExpression('#132129', '#4c5962', '#8a9298'),
      'text-opacity': buildPriorityValueExpression(0.98, 0.8, 0.38),
      'text-halo-color': buildPriorityValueExpression(
        'rgba(255,255,255,0.95)',
        'rgba(255,255,255,0.84)',
        'rgba(255,255,255,0.62)',
      ),
      'text-halo-width': buildPriorityValueExpression(1.15, 0.95, 0.7),
      'text-halo-blur': buildPriorityValueExpression(0.9, 1, 1.1),
    },
  } as StyleLayer
}

function stylePlaceLayer(layer: TextSymbolLayer): StyleLayer {
  const nextLayer: StyleLayer = {
    ...layer,
    layout: {
      ...layer.layout,
      'text-size': scaleTextSizeValue(
        layer.layout['text-size'],
        1,
        0.92,
        0.8,
      ),
    },
    paint: {
      ...layer.paint,
      'text-color': buildPriorityValueExpression('#1d2b33', '#516069', '#8b949b'),
      'text-opacity': buildPriorityValueExpression(0.94, 0.78, 0.48),
      'text-halo-color': buildPriorityValueExpression(
        'rgba(255,255,255,0.92)',
        'rgba(255,255,255,0.82)',
        'rgba(255,255,255,0.58)',
      ),
      'text-halo-width': buildPriorityValueExpression(1.05, 0.88, 0.62),
      'text-halo-blur': buildPriorityValueExpression(0.85, 0.95, 1.1),
    },
  }

  if (BOLD_LAYER_IDS.has(layer.id)) {
    nextLayer.layout = {
      ...nextLayer.layout,
      'text-font': buildPriorityFontExpression('Noto Sans Bold'),
    }
  }

  if (POINT_PLACE_LAYER_IDS.has(layer.id)) {
    nextLayer.paint = {
      ...nextLayer.paint,
      'icon-opacity': buildPriorityValueExpression(0.38, 0.24, 0.1),
    }
  }

  return nextLayer
}

function buildPriorityFontExpression(primaryFont: string): ExpressionSpecification {
  return [
    'case',
    IS_JAPAN_LABEL,
    ['literal', [primaryFont]],
    ['literal', ['Noto Sans Regular']],
  ] as unknown as ExpressionSpecification
}

function buildPriorityValueExpression(
  japanValue: unknown,
  taiwanValue: unknown,
  otherValue: unknown,
): ExpressionSpecification {
  return [
    'case',
    IS_JAPAN_LABEL,
    asExpressionValue(japanValue),
    IS_TAIWAN_LABEL,
    asExpressionValue(taiwanValue),
    asExpressionValue(otherValue),
  ] as unknown as ExpressionSpecification
}

function scaleNumericValue(value: unknown, factor: number): number | ExpressionSpecification {
  if (typeof value === 'number') {
    return Number((value * factor).toFixed(2))
  }

  return ['*', factor, asNumericExpressionValue(value)]
}

function scaleTextSizeValue(
  value: unknown,
  japanFactor: number,
  taiwanFactor: number,
  otherFactor: number,
): number | ExpressionSpecification {
  if (!Array.isArray(value)) {
    return buildPriorityValueExpression(
      scaleNumericValue(value, japanFactor),
      scaleNumericValue(value, taiwanFactor),
      scaleNumericValue(value, otherFactor),
    )
  }

  const operator = value[0]
  if (
    (operator === 'interpolate' || operator === 'interpolate-hcl' || operator === 'interpolate-lab') &&
    Array.isArray(value[2]) &&
    value[2][0] === 'zoom'
  ) {
    const scaled = [...value]
    for (let index = 4; index < scaled.length; index += 2) {
      scaled[index] = buildPriorityValueExpression(
        scaleNumericValue(scaled[index], japanFactor),
        scaleNumericValue(scaled[index], taiwanFactor),
        scaleNumericValue(scaled[index], otherFactor),
      )
    }
    return scaled as ExpressionSpecification
  }

  if (operator === 'step' && Array.isArray(value[1]) && value[1][0] === 'zoom') {
    const scaled = [...value]
    scaled[2] = buildPriorityValueExpression(
      scaleNumericValue(scaled[2], japanFactor),
      scaleNumericValue(scaled[2], taiwanFactor),
      scaleNumericValue(scaled[2], otherFactor),
    )
    for (let index = 4; index < scaled.length; index += 2) {
      scaled[index] = buildPriorityValueExpression(
        scaleNumericValue(scaled[index], japanFactor),
        scaleNumericValue(scaled[index], taiwanFactor),
        scaleNumericValue(scaled[index], otherFactor),
      )
    }
    return scaled as ExpressionSpecification
  }

  return buildPriorityValueExpression(
    scaleNumericValue(value, japanFactor),
    scaleNumericValue(value, taiwanFactor),
    scaleNumericValue(value, otherFactor),
  )
}

function asExpressionValue(value: unknown): number | string | ExpressionSpecification {
  if (typeof value === 'number' || typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value as ExpressionSpecification
  }

  return 12
}

function asNumericExpressionValue(value: unknown): number | ExpressionSpecification {
  if (typeof value === 'number') {
    return value
  }

  if (Array.isArray(value)) {
    return value as ExpressionSpecification
  }

  return 12
}
