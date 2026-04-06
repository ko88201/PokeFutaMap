export type PokemonEntry = {
  name: string
  number: number
}

export type PokeLidRecord = {
  area: string
  googleMapsUrl: string
  imageUrl: string
  isNew: boolean
  lat: number
  lng: number
  manholeNo: string
  name: string
  pokemon: PokemonEntry[]
  prefName: string
  prefSlug: string
  publishStartDate: string
  searchKeywords: string
  sourceUrl: string
}

export type QueryState = {
  area: string
  newOnly: boolean
  pokemon: string
  pref: string
}
