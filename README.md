# 100-stat

Statična spletna aplikacija za prikaz in osnovno analizo demografske statistike po SURS celicah `100 x 100 m` za Slovenijo.

## Kaj aplikacija omogoča

- prikaz grida na karti in obarvanje celic po `tot_p`
- izbor posameznih celic s klikom
- risanje ali nalaganje poligona (`geojson`, `json`, `zip`, `shp`)
- tri načine preseka poligona s celicami
- primerjavo `P1` in `P2` na istih grafih
- agregacijo atributov neposredno v brskalniku
- izvoz obogatenega GeoJSON za aktivni poligon

## Struktura

- `src/` React aplikacija
- `public/data/` pripravljeni podatki za frontend
- `public/admin/` opcijski administrativni sloji
- `scripts/prepare_data.py` priprava vhodnih podatkov
- `.github/workflows/deploy.yml` objava na GitHub Pages

## Lokalni zagon

```bash
npm install
npm run dev
```

Za produkcijski build:

```bash
npm run build
npm run preview
```

## Podatki

Frontend uporablja dva glavna tipa datotek:

- `public/data/grid-index.json`
- `public/data/attributes/<leto>.json`

`grid-index.json` vsebuje identifikatorje celic, koordinate središč in obseg mreže. Letne datoteke v `attributes/` vsebujejo stolpčni zapis atributov v enakem vrstnem redu kot `cell_ids`.

## Deploy

Repo je pripravljen za GitHub Pages prek workflowa v `.github/workflows/deploy.yml`.

Opomba: URL poti na GitHub Pages sledi imenu repozitorija. Če želiš javni naslov z `/100-stat/`, mora biti tudi repozitorij na GitHubu preimenovan v `100-stat`.
