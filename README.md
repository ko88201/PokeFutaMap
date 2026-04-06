# PokeFutaMap

日本各地のポケふたを地図と一覧で見られる GitHub Pages 向けサイトです。

## 開発

```bash
npm install
npm run dev
```

## データ更新

```bash
npm run sync:data
node scripts/update-japanese-pokelids.mjs
node scripts/localize-display-data.mjs
```

## 本番ビルド

```bash
npm run build
```
