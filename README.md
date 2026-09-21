# Pack Opening Simulator

ポケモンカードのパック／BOX開封結果を再現する非公式の静的Webアプリです。
カードマスターとセット別の推定封入ルールを読み込み、15パックまたは1BOXの開封結果を生成します。

## 対応セット

- M5 アビスアイ
- M6 ストームエメラルダ
- M6a 30th CELEBRATION

M6aは公式商品仕様に合わせ、1パック6枚・1BOX 20パックです。各パックに30周年特別仕様のピカチュウ1枚と基本エネルギー1枚を確定封入します。残り4枠の封入内訳は、公式発表ではない開封報告ベースの推定値です。RGBミュウは120BOXに1枚、赤・緑・青を各1/3とするユーザー指定の仮説値で抽選します。

## ローカル実行

JSONを`fetch()`するため、リポジトリルートをHTTPサーバーで配信します。

```powershell
py -m http.server 8000
```

ブラウザで`http://localhost:8000/`を開きます。ビルド工程やNode.js依存関係はありません。

## 主な構成

```text
index.html                 アプリ本体
src/app.js                 UI、データ読込、結果表示
src/simulator.js           パック／BOX抽選ロジック
data/sets/index.json       対応セット一覧
data/cards/{setCode}.json  カードマスター
data/rules/{setCode}.json  セット別封入ルール
assets/cards/{setCode}/    カード画像
assets/packs/              パック画像
tools/                     データ取得・整備ツール
```

## M6aデータの再整備

公式カード検索に掲載されるM6aカードと画像を取得した後、公式検索に個別掲載されないカード、基本エネルギー、RGBミュウ3種を補完します。

```powershell
py tools/fetch-card-master.py --start 50613 --end 50744 --set M6a --sleep 0.5
py tools/fetch_card_images.py --set M6a --sleep 0.3
py tools/complete_m6a_card_master.py
```

`complete_m6a_card_master.py`は、M6aに限定して不足カードの公開一覧を参照し、`data/cards/M6a.json`、`assets/cards/M6a/`、パック画像を整備します。実行前に取得元の公開状況と利用条件を確認してください。

## 注意事項

- 本アプリは非公式のファンツールです。
- 封入率には参考情報、実測、ユーザー仮説に基づく推定値が含まれます。
- カード名、画像、商標等の権利は各権利者に帰属します。
- 外部サイトからの取得時はアクセス間隔を設け、公開・再利用条件に配慮してください。
