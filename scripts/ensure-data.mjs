import { access, readFile } from 'node:fs/promises'

const files = [
  new URL('../public/data/pokelids.json', import.meta.url),
  new URL('../public/data/transit-index.json', import.meta.url),
  new URL('../public/data/transit.pmtiles', import.meta.url),
]

for (const file of files) {
  await access(file)
}

const pokelids = JSON.parse(await readFile(files[0], 'utf8'))
if (pokelids.length <= 400) {
  throw new Error('Poké Lid dataset is incomplete. Run `npm run sync:data` before build.')
}

console.log(`Using checked-in data bundle with ${pokelids.length} Poké Lids.`)
