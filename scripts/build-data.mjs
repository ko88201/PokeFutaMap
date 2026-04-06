import { writeFile } from 'node:fs/promises'

const PUBLIC_DATA_DIR = new URL('../public/data/', import.meta.url)

const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('')
const responses = await Promise.all(
  alphabet.map(async (keyword) => {
    const response = await fetch(
      `https://local.pokemon.jp/en/manhole/search/?keyword=${keyword}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch search results for ${keyword}`)
    }

    const payload = await response.json()
    return payload.list
  }),
)

const uniqueItems = new Map()
for (const batch of responses) {
  for (const item of batch) {
    uniqueItems.set(String(item.manhole_no), item)
  }
}

const japaneseTitles = new Map(
  await Promise.all(
    [...uniqueItems.keys()].map(async (manholeNo) => [
      manholeNo,
      await fetchJapaneseLidTitle(manholeNo),
    ]),
  ),
)

const lids = [...uniqueItems.values()]
  .map((item) => ({
    area: item.area || '',
    googleMapsUrl: `https://maps.google.com/?q=${item.lat},${item.lng}`,
    imageUrl: new URL(item.picture.url_l, 'https://local.pokemon.jp').toString(),
    isNew: Boolean(item.is_new),
    lat: Number(item.lat),
    lng: Number(item.lng),
    manholeNo: String(item.manhole_no),
    name:
      japaneseTitles.get(String(item.manhole_no)) ||
      item.name ||
      `ポケふた ${item.manhole_no}`,
    pokemon: item.pokemon_list.map((pokemon) => pokemon.name),
    prefName: item.pref_name,
    prefSlug: item.pref_en_name,
    publishStartDate: item.publish_start_date ?? '',
    searchKeywords: item.search_keyword ?? '',
    sourceUrl: `https://local.pokemon.jp/manhole/desc/${item.manhole_no}/`,
  }))
  .filter((lid) => Number.isFinite(lid.lat) && Number.isFinite(lid.lng))
  .sort((left, right) => Number(left.manholeNo) - Number(right.manholeNo))

await writeFile(
  new URL('./pokelids.json', PUBLIC_DATA_DIR),
  `${JSON.stringify(lids, null, 2)}\n`,
)

async function fetchJapaneseLidTitle(manholeNo) {
  try {
    const response = await fetch(
      `https://local.pokemon.jp/manhole/desc/${manholeNo}/?is_modal=1`,
    )
    if (!response.ok) {
      return ''
    }

    const html = await response.text()
    const headingMatch = html.match(/<h1>([^<]+)<\/h1>/)
    return headingMatch?.[1]?.trim() ?? ''
  } catch {
    return ''
  }
}
