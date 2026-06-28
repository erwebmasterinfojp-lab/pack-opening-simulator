## fetch_card_master.py について

`tools/fetch_card_master.py` は、ポケモンカード公式サイトのカード検索詳細ページからカード情報を取得し、カードマスターJSONを生成するためのスクリプトです。

取得対象のカードID範囲を指定し、その範囲内のカード詳細ページを順番に取得します。
取得したHTMLは `data/raw/` に保存され、パース結果は `data/cards/{setCode}.json` に出力されます。

## 取得元URL

カード詳細ページは以下の形式です。

```text
https://www.pokemon-card.com/card-search/details.php/card/{card_id}/regu/{regu}
```

例：

```text
https://www.pokemon-card.com/card-search/details.php/card/50220/regu/XY
```

## 実行前の準備

Pythonライブラリをインストールします。

```powershell
py -m pip install requests beautifulsoup4
```

または

```powershell
pip install requests beautifulsoup4
```

## 基本的な実行方法

例：カードID `50220` から `50320` までを取得し、`M5` のカードだけを `data/cards/M5.json` に出力する。

```powershell
py tools/fetch_card_master.py --start 50220 --end 50320 --set M5
```

## パラメータ一覧

| パラメータ        | 必須 | 例       | 説明                                                         |
| ------------ | -: | ------- | ---------------------------------------------------------- |
| `--start`    | 必須 | `50220` | 取得を開始する公式カードID。URL中の `/card/{card_id}/` に入る番号。             |
| `--end`      | 必須 | `50320` | 取得を終了する公式カードID。この番号も取得対象に含まれる。                             |
| `--set`      | 必須 | `M5`    | 出力対象とするパックコード。取得したカードの `setCode` がこの値と一致するカードだけをJSONに保存する。 |
| `--regu`     | 任意 | `XY`    | 公式URLの `regu` に指定する値。省略時は `XY`。                            |
| `--sleep`    | 任意 | `0.5`   | 1ページ取得するごとの待機秒数。公式サイトへの連続アクセス負荷を下げるために使用する。省略時は `0.5` 秒。   |
| `--no-cache` | 任意 | なし      | 保存済みHTMLキャッシュを使わず、公式サイトから再取得する。                            |

## パラメータの補足

### `--start`

取得開始カードIDです。
カード詳細URLに含まれる一意の番号を指定します。

例：

```text
/card/50220/
```

の場合、`50220` を指定します。

### `--end`

取得終了カードIDです。
`--start` から `--end` までの範囲を順番に取得します。

例：

```powershell
py tools/fetch_card_master.py --start 50220 --end 50320 --set M5
```

この場合、`50220` から `50320` までを取得します。

### `--set`

対象とするパックコードです。
取得したHTMLから `M5` などのパックコードを抽出し、指定した `--set` と一致したカードだけを保存します。

例：

```powershell
--set M5
```

これにより、`M5` 以外のカードは取得範囲に含まれていてもJSONには出力されません。

### `--regu`

公式URLの `regu` 部分に指定する値です。
省略した場合は `XY` になります。

例：

```powershell
py tools/fetch_card_master.py --start 50220 --end 50320 --set M5 --regu XY
```

### `--sleep`

カード詳細ページを1件取得するごとの待機秒数です。
公式サイトへ短時間に大量アクセスしないようにするためのパラメータです。

例：

```powershell
py tools/fetch_card_master.py --start 50220 --end 50320 --set M5 --sleep 1.0
```

### `--no-cache`

通常は、すでに `data/raw/` に保存済みのHTMLがある場合、そのHTMLを再利用します。
`--no-cache` を指定すると、保存済みHTMLを使わず、公式サイトから再取得します。

例：

```powershell
py tools/fetch_card_master.py --start 50220 --end 50320 --set M5 --no-cache
```

HTML構造が変わった可能性がある場合や、取得データを最新化したい場合に使用します。

## 出力されるファイル

### HTMLキャッシュ

```text
data/raw/{card_id}.html
```

例：

```text
data/raw/50220.html
```

公式カード詳細ページのHTMLを保存します。
パーサー修正時に、公式サイトへ再アクセスせずJSONを再生成できるようにするためです。

### カードマスターJSON

```text
data/cards/{setCode}.json
```

例：

```text
data/cards/M5.json
```

## JSON出力例

```json
[
  {
    "officialCardId": "50220",
    "setCode": "M5",
    "cardNo": "001",
    "cardNoTotal": "081",
    "name": "トロピウス",
    "category": "pokemon",
    "pokemonType": "草",
    "trainerType": null,
    "evolutionStage": "たね",
    "hp": 110,
    "packName": "拡張パック「アビスアイ」",
    "sourceUrl": "https://www.pokemon-card.com/card-search/details.php/card/50220/regu/XY"
  }
]
```

## JSON項目説明

| 項目               | 例              | 説明                                             |
| ---------------- | -------------- | ---------------------------------------------- |
| `officialCardId` | `50220`        | 公式カード詳細ページで使われている一意のカードID。                     |
| `setCode`        | `M5`           | パック・シリーズを表すコード。                                |
| `cardNo`         | `001`          | カード番号。                                         |
| `cardNoTotal`    | `081`          | そのセット内の通常カード総数。                                |
| `name`           | `トロピウス`        | カード名。                                          |
| `rarity`           | `U`        | カードレアリティ。                                          |
| `category`       | `pokemon`      | カード分類。`pokemon` / `trainer` / `unknown` のいずれか。 |
| `pokemonType`    | `草`            | ポケモンのタイプ。ポケモン以外では `null`。                      |
| `trainerType`    | `グッズ`          | トレーナーズの分類。グッズ、どうぐ、サポート、スタジアムなど。                |
| `evolutionStage` | `たね`           | 進化区分。ポケモン以外では `null`。                          |
| `hp`             | `110`          | HP。トレーナーズ等でもHTML上にHP表記がある場合は取得されることがある。        |
| `packName`       | `拡張パック「アビスアイ」` | 収録パック名。                                        |
| `sourceUrl`      | `https://...`  | 取得元の公式カード詳細URL。                                |

## 注意事項

* 公式サイトのHTML構造に依存しているため、公式サイト側のHTMLが変更されると取得できなくなる可能性があります。
* 画像URLは現時点ではJSONに保存していません。
* 公開Webサイト上で公式画像を直接利用する場合は、利用規約・権利関係に注意してください。
* `data/raw/` に保存したHTMLは開発・解析用のキャッシュです。
* 大量取得する場合は `--sleep` を長めに設定し、公式サイトに負荷をかけないようにしてください。

## よく使うコマンド

### M5を取得する

```powershell
py tools/fetch_card_master.py --start 50220 --end 50320 --set M5
```

### 範囲を広げてM5を取得する

```powershell
C:\Users\tsuma\git\pack-opening-simulator\tools\fetch-card-master.py --start 50220 --end 50380 --set M5
```

### キャッシュ(取込済みHTML)を使わずに再取得する

```powershell
C:\Users\tsuma\git\pack-opening-simulator\tools\fetch-card-master.py --start 50220 --end 50320 --set M5 --no-cache
```

### アクセス間隔を1秒にする

```powershell
C:\Users\tsuma\git\pack-opening-simulator\tools\fetch-card-master.py --start 50220 --end 50320 --set M5 --sleep 1.0
```
