---

## fetch_card_images.py について

`tools/fetch_card_images.py` は、カードマスターJSONに含まれる `sourceUrl` をもとに、ポケモンカード公式サイトのカード詳細ページからカード画像を取得し、ローカルに保存するためのスクリプトです。

取得した画像は `assets/cards/{setCode}/` に保存されます。
また、カードマスターJSONには以下の項目が追記されます。

* `imageUrl`
* `imageLocalPath`

これにより、Webページ側では `imageLocalPath` を参照してカード画像を表示できます。

## 前提

このスクリプトは、事前に `fetch_card_master.py` によってカードマスターJSONが作成されていることを前提としています。

例：

```text
data/cards/M5.json
```

また、公式カード詳細ページのHTMLキャッシュが `data/raw/` に存在する場合は、そのHTMLを再利用します。
存在しない場合は、カードマスターJSON内の `sourceUrl` から公式ページを取得します。

## 実行前の準備

`fetch_card_master.py` と同様に、以下のPythonライブラリを使用します。

```powershell
py -m pip install requests beautifulsoup4
```

または

```powershell
pip install requests beautifulsoup4
```

## 基本的な実行方法

例：`data/cards/M5.json` を読み込み、M5のカード画像を取得する。

```powershell
py tools/fetch_card_images.py --set M5
```

成功すると、画像が以下に保存されます。

```text
assets/cards/M5/
```

また、`data/cards/M5.json` に画像パス情報が追記されます。

## パラメータ一覧

| パラメータ              | 必須 | 例                    | 説明                                                         |
| ------------------ | -: | -------------------- | ---------------------------------------------------------- |
| `--set`            | 必須 | `M5`                 | 対象とするパックコード。通常は `data/cards/{setCode}.json` を読み込む。         |
| `--input`          | 任意 | `data/cards/M5.json` | 読み込むカードマスターJSONを明示的に指定する。省略時は `data/cards/{setCode}.json`。 |
| `--raw-dir`        | 任意 | `data/raw`           | HTMLキャッシュの保存・参照先ディレクトリ。省略時は `data/raw`。                    |
| `--output-dir`     | 任意 | `assets/cards/M5`    | 画像の保存先ディレクトリ。省略時は `assets/cards/{setCode}`。                |
| `--sleep`          | 任意 | `0.3`                | 1件処理するごとの待機秒数。公式サイトへの連続アクセス負荷を下げるために使用する。省略時は `0.3` 秒。     |
| `--overwrite`      | 任意 | なし                   | 既に画像ファイルが存在する場合でも再取得・上書きする。                                |
| `--no-update-json` | 任意 | なし                   | 画像は取得するが、カードマスターJSONは更新しない。                                |
| `--no-raw-cache`   | 任意 | なし                   | `data/raw/` のHTMLキャッシュを使わず、`sourceUrl` から公式ページを再取得する。      |

## パラメータの補足

### `--set`

対象とするパックコードです。

例：

```powershell
py tools/fetch_card_images.py --set M5
```

この場合、通常は以下のカードマスターを読み込みます。

```text
data/cards/M5.json
```

画像は以下に保存されます。

```text
assets/cards/M5/
```

### `--input`

カードマスターJSONのパスを明示的に指定します。

例：

```powershell
py tools/fetch_card_images.py --set M5 --input data/cards/M5.json
```

通常は `--set` だけで十分ですが、テスト用JSONや別名ファイルを使う場合に指定します。

### `--raw-dir`

HTMLキャッシュの参照先です。

通常は以下を使用します。

```text
data/raw/
```

`fetch_card_master.py` で取得済みのHTMLがある場合、公式サイトへ再アクセスせず、そのHTMLから画像URLを抽出できます。

### `--output-dir`

カード画像の保存先を指定します。

例：

```powershell
py tools/fetch_card_images.py --set M5 --output-dir assets/cards/M5
```

省略した場合は以下に保存されます。

```text
assets/cards/{setCode}/
```

### `--sleep`

1件処理するごとの待機秒数です。
公式サイトへ短時間に大量アクセスしないようにするためのパラメータです。

例：

```powershell
py tools/fetch_card_images.py --set M5 --sleep 1.0
```

### `--overwrite`

既に画像ファイルが存在する場合でも、再取得して上書きします。

例：

```powershell
py tools/fetch_card_images.py --set M5 --overwrite
```

画像ファイルを取り直したい場合に使用します。

### `--no-update-json`

画像の取得だけを行い、カードマスターJSONは更新しません。

例：

```powershell
py tools/fetch_card_images.py --set M5 --no-update-json
```

画像取得処理だけをテストしたい場合に使用します。

### `--no-raw-cache`

通常は `data/raw/` に保存済みのHTMLキャッシュを利用します。
`--no-raw-cache` を指定すると、HTMLキャッシュを使わず、カードマスターJSON内の `sourceUrl` から公式ページを再取得します。

例：

```powershell
py tools/fetch_card_images.py --set M5 --no-raw-cache
```

公式HTMLが更新された可能性がある場合に使用します。

## 出力されるファイル

### カード画像

```text
assets/cards/{setCode}/{cardNo}_{rarity}_{name}_{officialCardId}.jpg
```

例：

```text
assets/cards/M5/001_C_トロピウス_50220.jpg
assets/cards/M5/002_C_アゴジムシ_50221.jpg
assets/cards/M5/003_C_カリキリ_50222.jpg
```

ファイル名には以下を含めます。

* カード番号
* レアリティ
* カード名
* 公式カードID

### 更新されるカードマスターJSON

```text
data/cards/{setCode}.json
```

例：

```text
data/cards/M5.json
```

`fetch_card_images.py` 実行後、カードマスターJSONには画像関連項目が追記されます。

## JSON追記例

```json
{
  "officialCardId": "50220",
  "setCode": "M5",
  "cardNo": "001",
  "cardNoTotal": "081",
  "name": "トロピウス",
  "rarity": "C",
  "category": "pokemon",
  "pokemonType": "草",
  "trainerType": null,
  "evolutionStage": "たね",
  "hp": 110,
  "packName": "拡張パック「アビスアイ」",
  "sourceUrl": "https://www.pokemon-card.com/card-search/details.php/card/50220/regu/XY",
  "imageUrl": "https://www.pokemon-card.com/assets/images/card_images/large/M5/050220_P_TROPIUS.jpg",
  "imageLocalPath": "./assets/cards/M5/001_C_トロピウス_50220.jpg"
}
```

## 画像関連のJSON項目説明

| 項目               | 例                                         | 説明                        |
| ---------------- | ----------------------------------------- | ------------------------- |
| `imageUrl`       | `https://www.pokemon-card.com/...jpg`     | 公式カード詳細ページから抽出したカード画像URL。 |
| `imageLocalPath` | `./assets/cards/M5/001_C_トロピウス_50220.jpg` | ローカルに保存したカード画像のWeb表示用パス。  |

Webページ側では、原則として `imageLocalPath` を優先して利用します。
`imageLocalPath` が存在しない場合は、`imageUrl` または仮画像にフォールバックします。

## 手動追加カードについて

AR、SR、SAR、MURなどのうち、公式カード検索ページに存在しないカードは `sourceUrl` が `null` になる場合があります。

そのようなカードは `fetch_card_images.py` では自動取得できないため、処理時にスキップされます。

例：

```text
skip: 082 カリキリ AR sourceUrlなし
```

この挙動は正常です。

手動追加カードの画像を表示したい場合は、以下のいずれかで対応します。

1. 画像ファイルを手動で `assets/cards/{setCode}/` に保存する
2. カードマスターJSONの `imageLocalPath` を手動で設定する
3. 別サイト用の画像取得ツールを別途作成する

## よく使うコマンド

### M5のカード画像を取得する

```powershell
py tools/fetch_card_images.py --set M5
```

### M5のカード画像を再取得・上書きする

```powershell
py tools/fetch_card_images.py --set M5 --overwrite
```

### JSONを更新せず画像取得だけ試す

```powershell
py tools/fetch_card_images.py --set M5 --no-update-json
```

### HTMLキャッシュを使わず公式ページから再取得する

```powershell
py tools/fetch_card_images.py --set M5 --no-raw-cache
```

### アクセス間隔を1秒にする

```powershell
py tools/fetch_card_images.py --set M5 --sleep 1.0
```

## 注意事項

* 公式サイトのHTML構造に依存しているため、公式サイト側のHTMLが変更されると画像URLを取得できなくなる可能性があります。
* `sourceUrl` がないカードは自動画像取得できません。
* 取得した画像の利用にあたっては、権利・利用規約・公開範囲に注意してください。
* 公開Webサイトでカード画像を使用する場合は、非公式ファンツールであることを明記し、権利者からの要請があれば速やかに対応できるようにしてください。
* 大量取得する場合は `--sleep` を長めに設定し、公式サイトに負荷をかけないようにしてください。
