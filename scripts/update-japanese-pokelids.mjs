import { readFile, writeFile } from 'node:fs/promises'

const path = new URL('../public/data/pokelids.json', import.meta.url)
const lids = JSON.parse(await readFile(path, 'utf8'))
const updated = []

for (const lid of lids) {
  try {
    const response = await fetch(
      `https://local.pokemon.jp/manhole/desc/${lid.manholeNo}/?is_modal=1`,
    )
    const html = response.ok ? await response.text() : ''
    const heading = html.match(/<h1>([^<]+)<\/h1>/)?.[1]?.trim() ?? lid.name

    updated.push({
      ...lid,
      name: heading,
      sourceUrl: `https://local.pokemon.jp/manhole/desc/${lid.manholeNo}/`,
    })
  } catch {
    updated.push({
      ...lid,
      sourceUrl: `https://local.pokemon.jp/manhole/desc/${lid.manholeNo}/`,
    })
  }
}

await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`)
console.log(`Updated ${updated.length} Poké Lid records to Japanese-first links.`)
