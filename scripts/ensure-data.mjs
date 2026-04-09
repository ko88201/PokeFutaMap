import { access, readFile } from 'node:fs/promises'

const files = [
  new URL('../public/data/pokelids.json', import.meta.url),
]

for (const file of files) {
  await access(file)
}

const pokelids = JSON.parse(await readFile(files[0], 'utf8'))
if (pokelids.length <= 400) {
  throw new Error('Poké Lid dataset is incomplete. Run `npm run sync:data` before build.')
}

for (const lid of pokelids) {
  const accessibility = lid.accessibility
  if (
    !accessibility ||
    typeof accessibility.score !== 'number' ||
    typeof accessibility.band !== 'string' ||
    !Array.isArray(accessibility.reasons) ||
    !accessibility.metrics ||
    typeof accessibility.confidence !== 'string'
  ) {
    throw new Error(
      `Poké Lid ${lid.manholeNo} is missing accessibility data. Run \`npm run sync:data\` before build.`,
    )
  }

  const metrics = accessibility.metrics
  if (
    typeof metrics.nearestLidKm !== 'number' ||
    typeof metrics.nearbyLids10km !== 'number' ||
    typeof metrics.entryAccessModifier !== 'number' ||
    typeof metrics.isIsland !== 'boolean' ||
    typeof metrics.isMountain !== 'boolean'
  ) {
    throw new Error(
      `Poké Lid ${lid.manholeNo} has incomplete accessibility metrics. Run \`npm run sync:data\` before build.`,
    )
  }

  for (const key of [
    'nearestTrainKm',
    'nearestBusHubKm',
    'nearestFerryKm',
    'nearestAirportKm',
    'nearestIntlAirportKm',
    'nearestShinkansenKm',
    'nearestGatewayCityKm',
  ]) {
    const value = metrics[key]
    if (!(value === null || typeof value === 'number')) {
      throw new Error(
        `Poké Lid ${lid.manholeNo} has invalid metric \`${key}\`. Run \`npm run sync:data\` before build.`,
      )
    }
  }
}

console.log(`Using checked-in data bundle with ${pokelids.length} Poké Lids.`)
