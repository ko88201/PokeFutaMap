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

可達性スコアだけを再生成したい場合は、次のコマンドを使います。

```bash
npm run sync:accessibility
```

## 可達性スコア

地図上のドットは `1` から `5` までの可達性スコアを持ちます。`1` はかなり行きやすく、`5` は遠征向けです。

このスコアは 2 層で計算します。

- `base layer`: 日本国内での現地アクセス難度
- `additional layer for non-local people`: 非在地ユーザー向けの入口アクセス補正

最終スコアは [scripts/build-accessibility-data.mjs](/Users/ko88201/Documents/codex/PokeFutaMap/scripts/build-accessibility-data.mjs) で生成され、[public/data/pokelids.json](/Users/ko88201/Documents/codex/PokeFutaMap/public/data/pokelids.json) に保存されます。

### Base Layer

`base layer` は「その地点そのものがどれだけ行きやすいか」を見ます。初期値は `3` です。

- 駅が近いほど減点します。
  - `<= 1km`: `-1`
  - `> 1km` かつ `<= 5km`: `-0.5`
  - `> 5km` かつ `<= 15km`: `+0.5`
  - `> 15km` または駅データなし: `+1`
- 駅が遠い場合でも、徒歩圏のバス拠点やフェリー乗り場があれば減点します。
  - バス `<= 1km`: `-0.5`
  - フェリー `<= 1km`: `-0.5`
- 公共交通が薄い場合は加点します。
  - 駅 `> 15km` かつバス・フェリーともに `> 5km`: `+0.5`
- 地形条件を反映します。
  - 離島: `+1`
  - 山間部: `+1`
  - 地形加点は合計 `+2` まで
- 一般空港が比較的近ければ少し減点します。
  - 空港 `<= 25km`: `-0.5`
  - 離島で近い空港がない場合: `+0.5`
- 周辺のポケふたをまとめて回りやすい場合は減点します。
  - 最寄りの別ふた `<= 3km`: `-0.5`
  - `10km` 以内に別ふたが `3` 件以上: `-0.5`
  - まとまり補正は合計 `-1` まで
- 一部の例外地点は [scripts/data/accessibility-overrides.json](/Users/ko88201/Documents/codex/PokeFutaMap/scripts/data/accessibility-overrides.json) で個別に補正します。

### Additional Layer For Non-Local People

`additional layer for non-local people` は、海外旅行者や他地域から来るユーザーがそのエリアへ入りやすいかを見ます。これは `baseScore` の後に加算され、最終スコアを実際に変化させます。

```text
finalScore = clamp(round(baseScore + entryAccessModifier), 1, 5)
```

この補正は「行きやすくする方向」にだけ働き、下限は合計 `-1.5` です。

- 国際線空港
  - `<= 25km`: `-0.75`
  - `> 25km` かつ `<= 60km`: `-0.5`
- 新幹線駅
  - `<= 8km`: `-0.75`
  - `> 8km` かつ `<= 20km`: `-0.5`
- 主要ゲートウェイ都市
  - `<= 20km`: `-0.5`
  - `> 20km` かつ `<= 50km`: `-0.25`
- ただし、すでに国際線空港または新幹線補正が入っている場合、都市補正は最大でも `-0.25` です。

第 2 層で使う静的データは次のファイルで管理します。

- [scripts/data/international-airports.json](/Users/ko88201/Documents/codex/PokeFutaMap/scripts/data/international-airports.json)
- [scripts/data/shinkansen-stations.json](/Users/ko88201/Documents/codex/PokeFutaMap/scripts/data/shinkansen-stations.json)
- [scripts/data/gateway-cities.json](/Users/ko88201/Documents/codex/PokeFutaMap/scripts/data/gateway-cities.json)

### UI での見え方

- 地図上では最終スコアで色を決めます。
- `1` は緑寄り、`5` は赤寄りです。
- 数字ラベルは選択中、または地図を拡大したときに表示されます。
- ポップアップにはスコアと理由タグを表示します。

## 本番ビルド

```bash
npm run build
```
