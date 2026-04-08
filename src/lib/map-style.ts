import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'

const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

const JAPANESE_WITH_ENGLISH_LABEL: ExpressionSpecification = [
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
    ['concat', ['to-string', ['var', 'primary']], '\n', ['to-string', ['var', 'secondary']]],
    ['coalesce', ['var', 'primary'], ['var', 'secondary'], ''],
  ],
]

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
      if (layer.type !== 'symbol' || !layer.layout?.['text-field']) {
        return layer
      }

      return {
        ...layer,
        layout: {
          ...layer.layout,
          'text-field': JAPANESE_WITH_ENGLISH_LABEL,
        },
      }
    }),
  }
}
