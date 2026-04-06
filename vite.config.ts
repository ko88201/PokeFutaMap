import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'PokeFutaMap'
const base = process.env.GITHUB_ACTIONS === 'true' ? `/${repositoryName}/` : '/'

export default defineConfig({
  plugins: [react()],
  base,
})
