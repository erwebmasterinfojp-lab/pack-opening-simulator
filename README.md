# Pack Opening Simulator

ポケモンカードのパック開封シミュレーターです。
カードマスターを公式カード検索ページから取得し、JSON形式で保存したうえで、Webページ側で開封シミュレーションに利用します。

## ディレクトリ構成

```text
pack-opening-simulator/
├── index.html
├── data/
│   ├── cards/
│   │   └── M5.json
│   └── raw/
│       ├── 50220.html
│       ├── 50221.html
│       └── ...
└── tools/
    └── fetch_card_master.py
```

