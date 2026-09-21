# Current state

## 対応セット

- M5 アビスアイ: 5枚／パック、30パック／BOX
- M6 ストームエメラルダ: 5枚／パック、30パック／BOX
- M6a 30th CELEBRATION: 6枚／パック、20パック／BOX

セット一覧は`data/sets/index.json`、カードマスターは`data/cards/`、抽選ルールは`data/rules/`を参照する。

カード別集計と全カード一覧画像は、シークレット番号カード、通常ポケモン、トレーナーズ、SR以外のエネルギーの順で表示する。SRエネルギーはシークレット番号カードとして従来の高レア順を維持する。

## M6a固有仕様

`src/simulator.js`は、`packRules.generationStrategy`が`m6a30thCelebration`の場合に専用のBOX生成経路を使用する。

- 1パックごとに`PIKACHU`を1枚、`ENERGY`を1枚確定する。
- 残り4枚を通常カードとBOX単位の当たり枠から生成する。
- 現在の推定BOX内訳は、H 68枚、RR 5枚、AR 4枚、30周年復刻2枚、SARまたはFUR 1枚。
- SAR/FURは推定重み90:10で抽選する。
- RGBミュウは120BOXに1枚の確率で独立抽選し、当選時は通常H 1枚を置き換える。SAR/FUR枠は維持する。
- RGB当選時は赤・緑・青を同率（各1/3）で抽選し、同じパックへ他の当たりを重ねない。

公式に確認できるのは、1パック6枚、1BOX 20パック、各パックのピカチュウ1枚・基本エネルギー1枚の確定封入までである。その他の枚数と確率は`data/rules/M6a.json`に推定であることを明記している。

## M6aデータ

`data/cards/M6a.json`は176件、`assets/cards/M6a/`は176画像で構成する。

- 通常セット103種
- AR 20種
- SAR 10種
- FUR 2種
- RGBミュウ3種
- 30周年復刻30種
- 基本エネルギー8種

通常セットと復刻カードの大部分は公式カード検索ページを取得元とする。公式カード検索に個別掲載されない104〜135、LEGEND下側、基本エネルギーは、公式商品ページで収録を確認したうえで、公開カードショップ一覧の画像を補完利用している。LEGEND上側151/103は公式検索画像が上下連結画像のため、公開カードショップの上側単体画像へ差し替えている。RGBミュウ3種は公式一覧外のため、公開記事のカード情報と画像を補完利用している。再取得手順はREADMEを参照する。

## 参照元

- 公式商品情報・カード紹介: <https://www.30th.pokemon-card.com/product/m6a>
- 公式BOX商品仕様: <https://www.pokemoncenter-online.com/9900000008284.html>
- 推定BOX内訳の参考: <https://tinpanblog.com/pokemon-card-30th-celebration-cards-price-where-to-buy-guide/>
- RGBミュウ3種と画像の補完元: <https://media.on-gacha.com/pokecard-30th-celebration-release/>
- RGB封入率の参考（実測値として紹介）: <https://tcgpro.co.jp/media/pokeka-30th-atari/rgb-mew/>
- 公式検索未掲載画像の補完一覧: <https://torecacamp-pokemon.com/collections/m6a>
