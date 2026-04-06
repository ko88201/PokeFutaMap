import { readFile, writeFile } from 'node:fs/promises'

const PREFECTURE_NAME_JA = {
  aichi: '愛知県',
  akita: '秋田県',
  aomori: '青森県',
  chiba: '千葉県',
  ehime: '愛媛県',
  fukui: '福井県',
  fukuoka: '福岡県',
  fukushima: '福島県',
  gifu: '岐阜県',
  hokkaido: '北海道',
  hyogo: '兵庫県',
  ibaraki: '茨城県',
  ishikawa: '石川県',
  iwate: '岩手県',
  kagawa: '香川県',
  kagoshima: '鹿児島県',
  kanagawa: '神奈川県',
  kochi: '高知県',
  kyoto: '京都府',
  mie: '三重県',
  miyagi: '宮城県',
  miyazaki: '宮崎県',
  nagasaki: '長崎県',
  nara: '奈良県',
  niigata: '新潟県',
  okayama: '岡山県',
  okinawa: '沖縄県',
  osaka: '大阪府',
  saga: '佐賀県',
  saitama: '埼玉県',
  shiga: '滋賀県',
  shimane: '島根県',
  shizuoka: '静岡県',
  tochigi: '栃木県',
  tokushima: '徳島県',
  tokyo: '東京都',
  tottori: '鳥取県',
  toyama: '富山県',
  wakayama: '和歌山県',
  yamagata: '山形県',
  yamaguchi: '山口県',
}

const REGIONAL_PREFIX_ZHTW = {
  Alolan: '阿羅拉',
  Galarian: '伽勒爾',
  Hisuian: '洗翠',
  Paldean: '帕底亞',
}

const SPECIES_ALIAS = {
  "Farfetch’d": 'farfetchd',
  "Farfetch'd": 'farfetchd',
  Flabébé: 'flabebe',
  'Galarian Farfetch’d': 'farfetchd',
  "Galarian Farfetch'd": 'farfetchd',
  'Hakamo-o': 'hakamo-o',
  'Ho-Oh': 'ho-oh',
  'Jangmo-o': 'jangmo-o',
  'Kommo-o': 'kommo-o',
  'Mime Jr.': 'mime-jr',
  'Mr. Mime': 'mr-mime',
  'Mr. Rime': 'mr-rime',
  "Sirfetch’d": 'sirfetchd',
}

const NAME_OVERRIDE_ZHTW = {
  Farfetchd: '大蔥鴨',
  Flabebe: '花蓓蓓',
}

const path = new URL('../public/data/pokelids.json', import.meta.url)
const lids = JSON.parse(await readFile(path, 'utf8'))
const uniquePokemon = [
  ...new Set(
    lids.flatMap((lid) =>
      lid.pokemon.map((pokemon) =>
        typeof pokemon === 'string' ? pokemon : pokemon.name,
      ),
    ),
  ),
].sort()

const cache = new Map()
const batchSize = 8

for (let index = 0; index < uniquePokemon.length; index += batchSize) {
  const batch = uniquePokemon.slice(index, index + batchSize)
  const translatedBatch = await Promise.all(
    batch.map(async (name) => [name, await translatePokemon(name)]),
  )

  for (const [name, translated] of translatedBatch) {
    cache.set(name, translated)
  }
}

const localized = lids.map((lid) => ({
  ...lid,
  pokemon: lid.pokemon
    .map((pokemon) => {
      const originalName = typeof pokemon === 'string' ? pokemon : pokemon.name
      const localizedPokemon = cache.get(originalName)

      return (
        localizedPokemon ?? {
          name: originalName,
          number: typeof pokemon === 'string' ? 0 : pokemon.number,
        }
      )
    })
    .sort((left, right) => left.number - right.number || left.name.localeCompare(right.name, 'zh-Hant')),
  prefName: PREFECTURE_NAME_JA[lid.prefSlug] ?? lid.prefName,
}))

await writeFile(path, `${JSON.stringify(localized, null, 2)}\n`)
console.log(`Localized ${localized.length} Poké Lid records.`)

async function translatePokemon(name) {
  const regionalMatch = name.match(/^(Alolan|Galarian|Hisuian|Paldean)\s+(.+)$/)
  if (regionalMatch) {
    const [, regionalPrefix, baseName] = regionalMatch
    const baseTranslation = await translatePokemon(baseName)
    return {
      name: `${REGIONAL_PREFIX_ZHTW[regionalPrefix]}${baseTranslation.name}`,
      number: baseTranslation.number,
    }
  }

  const slug = SPECIES_ALIAS[name] ?? normalizeSpeciesSlug(name)
  try {
    const response = await fetchWithRetry(
      `https://pokeapi.co/api/v2/pokemon-species/${slug}/`,
    )
    if (!response.ok) {
      return { name, number: 0 }
    }

    const payload = await response.json()
    const zhtwName = payload.names.find(
      (entry) => entry.language?.name === 'zh-hant',
    )?.name

    return {
      name: NAME_OVERRIDE_ZHTW[toPascalKey(slug)] ?? zhtwName ?? name,
      number: payload.id ?? 0,
    }
  } catch {
    return { name, number: 0 }
  }
}

async function fetchWithRetry(url, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      if (attempt === 2) {
        throw error
      }
    }
  }

  throw new Error(`Failed to fetch ${url}`)
}

function normalizeSpeciesSlug(name) {
  return name
    .replace(/’/g, '')
    .replace(/'/g, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
}

function toPascalKey(value) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}
